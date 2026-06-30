import type { ExtensionContext } from "@silo-code/sdk";
import { parseGitHubRemote } from "./parse-remote";
import { fetchRuns, checkAuth, WorkflowRun } from "./github-api";
import {
  ghStore,
  WorkspaceGhState,
  aggregateRunState,
  deriveStatusBarState,
  StatusBarState,
} from "./store";
import type { WorkspaceBadge, WorkspaceStatusRow } from "@silo-code/sdk";
import { AuthHelpModal } from "./auth-help-modal";

const AUTH_RETRY_INTERVAL_MS = 2 * 60_000;

async function resolveRemote(
  ctx: ExtensionContext,
  folder: string,
): Promise<{ owner: string; repo: string } | null> {
  const result = await ctx.process.exec(
    "git",
    ["config", "--get", "remote.origin.url"],
    { cwd: folder },
  );
  if (result.code !== 0) {
    ctx.log.debug(`No git remote found in ${folder}`);
    return null;
  }
  const url = result.stdout.trim();
  const parsed = parseGitHubRemote(url);
  if (!parsed) {
    ctx.log.debug(`Remote URL is not a GitHub remote — skipping (url: "${url}")`);
  }
  return parsed;
}

async function resolveHeadBranch(
  ctx: ExtensionContext,
  folder: string,
): Promise<string | null> {
  const result = await ctx.process.exec(
    "git",
    ["rev-parse", "--abbrev-ref", "HEAD"],
    { cwd: folder },
  );
  if (result.code !== 0) return null;
  return result.stdout.trim() || null;
}

export class GhActionsService {
  private _timers = new Map<string, ReturnType<typeof setInterval>>();
  private _authRetryTimer: ReturnType<typeof setInterval> | null = null;
  private _reconcileDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _refreshingWorkspaces = new Set<string>();
  private _seenFailedRuns = new Set<number>();
  private _ctx: ExtensionContext | null = null;

  async init(ctx: ExtensionContext): Promise<void> {
    this._ctx = ctx;
    ctx.log.info("GitHub Actions extension initializing");
    ghStore.hydrate(ctx.storage.global);

    // Wire up decoration invalidation unconditionally — needed whether auth
    // succeeds now or later via the retry timer.
    ghStore.subscribe(() => {
      ctx.workspaces.invalidateBadges();
      ctx.workspaces.invalidateStatus();
    });

    const authState = await checkAuth(ctx);
    ghStore.setAuthState(authState);

    if (authState !== "ok") {
      const reason = authState === "missing" ? "gh CLI not found" : "not authenticated";
      ctx.log.warn(`${reason} — will retry every ${AUTH_RETRY_INTERVAL_MS / 1000}s`);
      this._notifyAuthIssue(ctx, authState);
      this._authRetryTimer = setInterval(async () => {
        const state = await checkAuth(ctx);
        if (state === "ok") {
          ctx.log.info("Authentication succeeded — starting workspace polling");
          ghStore.setAuthState("ok");
          clearInterval(this._authRetryTimer!);
          this._authRetryTimer = null;
          ctx.workspaces.subscribe(() => this._scheduleReconcile(ctx));
          this._reconcileWorkspaces(ctx);
        } else {
          ghStore.setAuthState(state);
        }
      }, AUTH_RETRY_INTERVAL_MS);
      return;
    }

    this._reconcileWorkspaces(ctx);
    ctx.workspaces.subscribe(() => this._scheduleReconcile(ctx));
  }

  private _notifyAuthIssue(ctx: ExtensionContext, state: "unauthenticated" | "missing"): void {
    const isMissing = state === "missing";
    ctx.ui.notify(
      "warn",
      isMissing
        ? "The gh CLI was not detected. Install it and run `gh auth login` to enable GitHub Actions monitoring."
        : "GitHub Actions monitoring requires `gh auth login`. Run it in a terminal to authenticate.",
      {
        title: isMissing ? "GitHub Actions: gh CLI not found" : "GitHub Actions: not authenticated",
        actions: [
          {
            label: "Show setup",
            run: () =>
              ctx.ui.showModal((close) => <AuthHelpModal close={close} ctx={ctx} />, {
                title: "GitHub Actions — Setup",
                dismissible: true,
                size: "md",
              }),
          },
        ],
      }
    );
  }

  private _scheduleReconcile(ctx: ExtensionContext): void {
    if (this._reconcileDebounceTimer) clearTimeout(this._reconcileDebounceTimer);
    this._reconcileDebounceTimer = setTimeout(() => {
      this._reconcileDebounceTimer = null;
      this._reconcileWorkspaces(ctx);
    }, 150);
  }

  private _reconcileWorkspaces(ctx: ExtensionContext): void {
    const wsState = ctx.workspaces.getState();
    const activeId = wsState.activeId ?? undefined;
    const allOpen = wsState.open;

    ctx.log.debug(`Reconciling workspaces — ${allOpen.length} open, active: ${activeId ?? "none"}`);

    const liveIds = new Set(allOpen.map((w) => w.id));
    for (const id of ghStore.workspaces.keys()) {
      if (!liveIds.has(id)) {
        ctx.log.debug(`Removing closed workspace: ${id}`);
        this._clearTimer(id);
        ghStore.removeWorkspace(id);
      }
    }

    for (const ws of allOpen) {
      if (ws.id === activeId) {
        this._refreshWorkspace(ctx, ws.id, ws.folder);
        this._startPolling(ctx, ws.id, ws.folder, false);
      } else if (!this._timers.has(ws.id)) {
        this._refreshWorkspace(ctx, ws.id, ws.folder);
        this._startPolling(ctx, ws.id, ws.folder, true);
      }
    }
  }

  private _startPolling(
    ctx: ExtensionContext,
    workspaceId: string,
    folder: string,
    inactive: boolean,
  ): void {
    this._clearTimer(workspaceId);
    const interval = inactive
      ? ghStore.settings.inactivePollIntervalMs
      : ghStore.settings.activePollIntervalMs;
    this._timers.set(
      workspaceId,
      setInterval(() => this._refreshWorkspace(ctx, workspaceId, folder), interval),
    );
  }

  private async _refreshWorkspace(
    ctx: ExtensionContext,
    workspaceId: string,
    folder: string,
  ): Promise<void> {
    if (this._refreshingWorkspaces.has(workspaceId)) {
      ctx.log.debug(`Skipping refresh for workspace ${workspaceId} — fetch already in flight`);
      return;
    }
    this._refreshingWorkspaces.add(workspaceId);
    try {
      if (!ghStore.authenticated) {
        ctx.log.debug(`Skipping refresh for workspace ${workspaceId} — not authenticated`);
        const state: WorkspaceGhState = {
          repoInfo: null, branch: null, runs: [], lastFetched: null,
          error: { kind: "unauthenticated" },
        };
        ghStore.setWorkspaceState(workspaceId, state);
        ctx.log.debug(`Status bar state for workspace ${workspaceId}: "unauthenticated"`);
        return;
      }

      const repoInfo = await resolveRemote(ctx, folder);
      if (!repoInfo) {
        ctx.log.debug(`No GitHub remote found for workspace ${workspaceId} (${folder})`);
        const state: WorkspaceGhState = {
          repoInfo: null, branch: null, runs: [], lastFetched: null,
          error: { kind: "no-repo" },
        };
        ghStore.setWorkspaceState(workspaceId, state);
        ctx.log.debug(`Status bar state for workspace ${workspaceId}: "hidden" (no-repo)`);
        return;
      }

      const branch = (await resolveHeadBranch(ctx, folder)) ?? "main";
      const currentBranchOnly = ghStore.getWorkspaceCurrentBranchOnly(workspaceId);
      ctx.log.debug(`Refreshing ${repoInfo.owner}/${repoInfo.repo}@${branch} for workspace ${workspaceId}`, { currentBranchOnly });
      const result = await fetchRuns(ctx, repoInfo.owner, repoInfo.repo, folder);

      if (!result.ok) {
        ctx.log.warn(`Error fetching runs for workspace ${workspaceId}`, { error: result.error });
        const prev = ghStore.workspaces.get(workspaceId);
        ghStore.setWorkspaceState(workspaceId, {
          repoInfo, branch,
          runs: prev?.runs ?? [],
          lastFetched: prev?.lastFetched ?? null,
          error: { kind: "api-error", error: result.error },
        });
        ctx.log.debug(`Status bar state for workspace ${workspaceId}: "api-error" (${result.error.message})`);
        return;
      }

      const runs = currentBranchOnly
        ? result.runs.filter((r) => r.head_branch === branch)
        : result.runs;

      const prev = ghStore.workspaces.get(workspaceId);
      const isFirstFetch = !prev || prev.lastFetched === null;
      const next: WorkspaceGhState = {
        repoInfo, branch, runs,
        lastFetched: new Date(),
        error: null,
      };

      ghStore.setWorkspaceState(workspaceId, next);
      if (isFirstFetch) {
        for (const run of runs) {
          if (run.status === "completed" && run.conclusion === "failure") {
            this._seenFailedRuns.add(run.id);
          }
        }
        ctx.log.debug(`Seeded ${this._seenFailedRuns.size} pre-existing failed run(s) for workspace ${workspaceId} — no notifications`);
      } else {
        this._detectAndNotifyNewFailures(ctx, workspaceId, runs);
      }

      const { failed, running } = aggregateRunState(runs, ghStore.getClearedAt(workspaceId));
      ctx.log.debug(`Status bar state for workspace ${workspaceId}: "${deriveStatusBarState(next, ghStore.getClearedAt(workspaceId)).kind}" (${failed} failed, ${running} running)`);
    } finally {
      this._refreshingWorkspaces.delete(workspaceId);
    }
  }

  private _detectAndNotifyNewFailures(
    ctx: ExtensionContext,
    workspaceId: string,
    runs: WorkflowRun[],
  ): void {
    for (const run of runs) {
      if (run.status === "completed" && run.conclusion === "failure") {
        if (!this._seenFailedRuns.has(run.id)) {
          this._seenFailedRuns.add(run.id);
          const ws = ctx.workspaces.get(workspaceId);
          ctx.log.warn(`New workflow failure detected: "${run.name}" in ${ws?.name}`, { runId: run.id, url: run.html_url });
        }
      }
    }
  }

  private _clearTimer(workspaceId: string): void {
    const t = this._timers.get(workspaceId);
    if (t !== undefined) {
      clearInterval(t);
      this._timers.delete(workspaceId);
    }
  }

  async refreshActive(): Promise<void> {
    if (!this._ctx) return;
    const activeId = this._ctx.workspaces.getState().activeId;
    if (!activeId) return;
    const ws = this._ctx.workspaces.get(activeId);
    if (!ws) return;
    await this._refreshWorkspace(this._ctx, activeId, ws.folder);
  }

  clearAlerts(workspaceId: string): void {
    ghStore.clearAlerts(workspaceId);
  }

  getBadgesFor(workspaceId: string): WorkspaceBadge[] {
    const ws = ghStore.workspaces.get(workspaceId);
    if (!ws || ws.error?.kind === "no-repo" || !ws.repoInfo) return [];
    const { failed } = aggregateRunState(ws.runs, ghStore.getClearedAt(workspaceId));
    if (failed === 0) return [];
    return [{ id: "gh-actions-failed", text: String(failed), color: "var(--silo-color-danger, #e53e3e)" }];
  }

  getDecorationsFor(workspaceId: string): WorkspaceStatusRow[] {
    const ws = ghStore.workspaces.get(workspaceId);
    if (!ws || ws.error?.kind === "no-repo" || !ws.repoInfo) return [];

    const clearedBefore = ghStore.getClearedAt(workspaceId);
    const { failed, running } = aggregateRunState(ws.runs, clearedBefore);

    if (failed > 0) {
      const oldest = ws.runs
        .filter((r) => r.status === "completed" && r.conclusion === "failure" && (!clearedBefore || new Date(r.created_at) > clearedBefore))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
      return [{
        id: "gh-actions",
        status: "error",
        label: failed === 1 ? "1 workflow failed" : `${failed} workflows failed`,
        startedAt: oldest?.created_at,
      }];
    }

    if (running > 0) {
      return [{ id: "gh-actions", status: "busy", label: running === 1 ? "1 workflow running" : `${running} workflows running` }];
    }

    return [];
  }

  getStatusBarState(): StatusBarState {
    if (!ghStore.initialized) return { kind: "hidden" };
    if (ghStore.authState === "missing") return { kind: "gh-missing" };
    if (ghStore.authState === "unauthenticated") return { kind: "unauthenticated" };
    if (!this._ctx) return { kind: "hidden" };
    const activeId = this._ctx.workspaces.getState().activeId;
    if (!activeId) return { kind: "hidden" };
    return deriveStatusBarState(ghStore.workspaces.get(activeId), ghStore.getClearedAt(activeId));
  }

  subscribe(fn: () => void): () => void {
    return ghStore.subscribe(fn);
  }

  dispose(): void {
    for (const id of this._timers.keys()) this._clearTimer(id);
    if (this._authRetryTimer) {
      clearInterval(this._authRetryTimer);
      this._authRetryTimer = null;
    }
    if (this._reconcileDebounceTimer) {
      clearTimeout(this._reconcileDebounceTimer);
      this._reconcileDebounceTimer = null;
    }
  }
}
