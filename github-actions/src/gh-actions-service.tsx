import type { ExtensionContext } from "@silo-code/sdk";
import { parseGitHubRemote } from "./parse-remote";
import { fetchRuns, checkAuth, resolveGhBin, rerunWorkflow, WorkflowRun } from "./github-api";
import {
  ghStore,
  WorkspaceGhState,
  aggregateRunState,
  deriveWorkspaceStatusBarState,
  selectFailedRuns,
  StatusBarState,
} from "./store";
import type { WorkspaceBadge, WorkspaceStatusRow, Disposable } from "@silo-code/sdk";
import { AuthHelpModal } from "./auth-help-modal";
import { getTooltip, getRichTooltip } from "./status-labels";

const AUTH_RETRY_INTERVAL_MS = 2 * 60_000;
const RECONCILE_DEBOUNCE_MS = 150;
const MIN_FETCH_INTERVAL_MS = 10_000;

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
  // Key: `${workspaceId}:${folder}` — prevents concurrent refreshes per folder.
  private _refreshingFolders = new Set<string>();
  private _seenFailedRuns = new Set<number>();
  // Current polling mode per workspace. Reconciles are driven by workspace
  // events that fire on unrelated changes (terminal output, editor tabs), so
  // refresh/restart only on mode transitions — never on every event.
  private _pollingMode = new Map<string, "active" | "inactive">();
  private _knownFolders = new Map<string, Set<string>>();
  private _lastFetchedAt = new Map<string, number>();
  private _lastActiveIntervalMs: number | null = null;
  private _lastInactiveIntervalMs: number | null = null;
  private _ctx: ExtensionContext | null = null;
  private _ghBin = "gh";
  private _storeUnsub: (() => void) | null = null;
  private _wsSub: Disposable | null = null;

  async init(ctx: ExtensionContext): Promise<void> {
    this._ctx = ctx;
    ctx.log.info("GitHub Actions extension initializing");
    ghStore.hydrate(ctx.storage.global);

    try {
      this._ghBin = await resolveGhBin(ctx);
    } catch (err) {
      // PathDeniedError (or similar) during probe — keep the bare name and let
      // checkAuth classify / defer rather than crashing activate.
      ctx.log.debug(`resolveGhBin deferred (${err})`);
      this._ghBin = "gh";
    }

    // Wire up decoration invalidation unconditionally — needed whether auth
    // succeeds now or later via the retry timer.
    this._storeUnsub = ghStore.subscribe(() => {
      ctx.workspaces.invalidateBadges();
      ctx.workspaces.invalidateStatus();
      this._applySettingsChange(ctx);
    });

    const authState = await checkAuth(ctx, this._ghBin);
    ghStore.setAuthState(authState);

    if (authState !== "ok") {
      if (authState === "deferred") {
        ctx.log.info(`Auth check deferred (no usable cwd yet) — will retry every ${AUTH_RETRY_INTERVAL_MS / 1000}s`);
      } else {
        const reason = authState === "missing" ? "gh CLI not found" : "not authenticated";
        ctx.log.warn(`${reason} — will retry every ${AUTH_RETRY_INTERVAL_MS / 1000}s`);
        this._notifyAuthIssue(ctx, authState);
      }
      this._authRetryTimer = setInterval(async () => {
        // Re-resolve in case the first attempt was deferred (no workspace yet).
        try {
          this._ghBin = await resolveGhBin(ctx);
        } catch {
          /* keep previous _ghBin */
        }
        const state = await checkAuth(ctx, this._ghBin);
        if (state === "ok") {
          ctx.log.info("Authentication succeeded — starting workspace polling");
          ghStore.setAuthState("ok");
          clearInterval(this._authRetryTimer!);
          this._authRetryTimer = null;
          this._wsSub = ctx.workspaces.subscribe(() => this._scheduleReconcile(ctx));
          this._reconcileWorkspaces(ctx);
        } else {
          ghStore.setAuthState(state);
        }
      }, AUTH_RETRY_INTERVAL_MS);
      return;
    }

    this._reconcileWorkspaces(ctx);
    this._wsSub = ctx.workspaces.subscribe(() => this._scheduleReconcile(ctx));
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
                size: "sm",
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
    }, RECONCILE_DEBOUNCE_MS);
  }

  private _reconcileWorkspaces(ctx: ExtensionContext): void {
    const wsState = ctx.workspaces.getState();
    const activeId = wsState.activeId ?? undefined;
    const allOpen = wsState.open;

    // Remove state for workspaces that are no longer open.
    const liveIds = new Set(allOpen.map((w) => w.id));
    for (const id of [...this._pollingMode.keys()]) {
      if (!liveIds.has(id)) {
        ctx.log.debug(`Removing closed workspace: ${id}`);
        this._clearTimer(id);
        this._pollingMode.delete(id);
        this._knownFolders.delete(id);
        ghStore.removeWorkspace(id);
      }
    }

    for (const ws of allOpen) {
      const folders = [ws.folder, ...(ws.extraFolders ?? [])];

      // Prune stale folder entries when a folder has been removed from the workspace.
      const liveFolderSet = new Set(folders);
      for (const state of ghStore.getRepoStates(ws.id)) {
        if (!liveFolderSet.has(state.folder)) {
          ctx.log.debug(`Removing stale folder ${state.folder} from workspace ${ws.id}`);
          ghStore.removeFolderState(ws.id, state.folder);
        }
      }
      let known = this._knownFolders.get(ws.id);
      if (!known) {
        known = new Set();
        this._knownFolders.set(ws.id, known);
      }
      for (const f of [...known]) {
        if (!liveFolderSet.has(f)) known.delete(f);
      }

      const mode = ws.id === activeId ? "active" : "inactive";
      const modeChanged = this._pollingMode.get(ws.id) !== mode;
      if (modeChanged) {
        this._pollingMode.set(ws.id, mode);
        this._startPolling(ctx, ws.id, mode === "inactive");
      }

      // Fetch immediately only when the workspace just became active or a
      // folder is newly seen; otherwise let the poll timer drive fetches.
      // Activation fetches are throttled: skip if we fetched this workspace
      // within the last MIN_FETCH_INTERVAL_MS (rapid workspace-switching).
      const becameActive = modeChanged && mode === "active";
      const sinceLastFetch = Date.now() - (this._lastFetchedAt.get(ws.id) ?? 0);
      const activationThrottled = becameActive && sinceLastFetch < MIN_FETCH_INTERVAL_MS;
      let willFetch = false;
      for (const folder of folders) {
        const isNewFolder = !known.has(folder);
        known.add(folder);
        if (isNewFolder || (becameActive && !activationThrottled)) {
          this._refreshFolder(ctx, ws.id, folder);
          willFetch = true;
        }
      }
      if (willFetch) this._lastFetchedAt.set(ws.id, Date.now());
    }
  }

  // Restart timers when the poll intervals change so new settings apply
  // without waiting for a workspace switch.
  private _applySettingsChange(ctx: ExtensionContext): void {
    const { activePollIntervalMs, inactivePollIntervalMs } = ghStore.settings;
    if (
      this._lastActiveIntervalMs === activePollIntervalMs &&
      this._lastInactiveIntervalMs === inactivePollIntervalMs
    ) {
      return;
    }
    const isFirst = this._lastActiveIntervalMs === null;
    this._lastActiveIntervalMs = activePollIntervalMs;
    this._lastInactiveIntervalMs = inactivePollIntervalMs;
    if (isFirst) return;
    for (const [id, mode] of this._pollingMode) {
      this._startPolling(ctx, id, mode === "inactive");
    }
  }

  private _startPolling(
    ctx: ExtensionContext,
    workspaceId: string,
    inactive: boolean,
  ): void {
    this._clearTimer(workspaceId);
    const interval = inactive
      ? ghStore.settings.inactivePollIntervalMs
      : ghStore.settings.activePollIntervalMs;
    this._timers.set(
      workspaceId,
      setInterval(() => {
        const ws = ctx.workspaces.get(workspaceId);
        if (!ws) return;
        this._lastFetchedAt.set(workspaceId, Date.now());
        for (const folder of [ws.folder, ...(ws.extraFolders ?? [])]) {
          this._refreshFolder(ctx, workspaceId, folder);
        }
      }, interval),
    );
  }

  private async _refreshFolder(
    ctx: ExtensionContext,
    workspaceId: string,
    folder: string,
  ): Promise<void> {
    const refreshKey = `${workspaceId}:${folder}`;
    if (this._refreshingFolders.has(refreshKey)) {
      ctx.log.debug(`Skipping refresh for ${folder} in workspace ${workspaceId} — fetch already in flight`);
      return;
    }
    this._refreshingFolders.add(refreshKey);
    try {
      if (!ghStore.authenticated) {
        ctx.log.debug(`Skipping refresh for workspace ${workspaceId} — not authenticated`);
        ghStore.setFolderState(workspaceId, folder, {
          folder, repoInfo: null, branch: null, runs: [], lastFetched: null,
          error: { kind: "unauthenticated" },
        });
        return;
      }

      const [repoInfo, headBranch] = await Promise.all([
        resolveRemote(ctx, folder),
        resolveHeadBranch(ctx, folder),
      ]);
      if (!repoInfo) {
        ctx.log.debug(`No GitHub remote found for folder ${folder} in workspace ${workspaceId}`);
        // Remove any previously stored state so it doesn't linger.
        ghStore.removeFolderState(workspaceId, folder);
        return;
      }

      const branch = headBranch ?? "main";
      const currentBranchOnly = ghStore.getWorkspaceCurrentBranchOnly(workspaceId);
      ctx.log.debug(`Refreshing ${repoInfo.owner}/${repoInfo.repo}@${branch} (${folder})`, { currentBranchOnly });
      const result = await fetchRuns(ctx, repoInfo.owner, repoInfo.repo, folder, this._ghBin);

      if (!result.ok) {
        ctx.log.warn(`Error fetching runs for ${folder} in workspace ${workspaceId}`, { error: result.error });
        const prev = ghStore.getRepoStates(workspaceId).find((s) => s.folder === folder);
        ghStore.setFolderState(workspaceId, folder, {
          folder, repoInfo, branch,
          runs: prev?.runs ?? [],
          lastFetched: prev?.lastFetched ?? null,
          error: { kind: "api-error", error: result.error },
        });
        return;
      }

      const runs = currentBranchOnly
        ? result.runs.filter((r) => r.head_branch === branch)
        : result.runs;

      const prev = ghStore.getRepoStates(workspaceId).find((s) => s.folder === folder);
      const isFirstFetch = !prev || prev.lastFetched === null;
      const next: WorkspaceGhState = {
        folder, repoInfo, branch, runs,
        lastFetched: new Date(),
        error: null,
      };

      ghStore.setFolderState(workspaceId, folder, next);
      if (isFirstFetch) {
        for (const run of runs) {
          if (run.status === "completed" && run.conclusion === "failure") {
            this._seenFailedRuns.add(run.id);
          }
        }
        ctx.log.debug(`Seeded ${this._seenFailedRuns.size} pre-existing failed run(s) for ${folder} — no notifications`);
      } else {
        this._detectAndNotifyNewFailures(ctx, workspaceId, runs);
      }
    } finally {
      this._refreshingFolders.delete(refreshKey);
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
    await this.refreshWorkspace(activeId);
  }

  // Workspace-scoped refresh — unlike refreshActive, works for any workspace,
  // not just the currently active one (needed by the workspace properties
  // tab and the workspace context-menu "Refresh" action, since either can
  // target a workspace that isn't active).
  async refreshWorkspace(workspaceId: string): Promise<void> {
    if (!this._ctx) return;
    const ws = this._ctx.workspaces.get(workspaceId);
    if (!ws) return;
    for (const folder of [ws.folder, ...(ws.extraFolders ?? [])]) {
      await this._refreshFolder(this._ctx, workspaceId, folder);
    }
  }

  async rerun(owner: string, repo: string, runId: number, cwd: string): Promise<{ ok: boolean; message?: string }> {
    if (!this._ctx) return { ok: false, message: "Service not initialized" };
    return rerunWorkflow(this._ctx, owner, repo, runId, cwd, this._ghBin);
  }

  clearAlerts(workspaceId: string): void {
    ghStore.clearAlerts(workspaceId);
  }

  getBadgesFor(workspaceId: string): WorkspaceBadge[] {
    const states = ghStore.getRepoStates(workspaceId).filter((s) => s.repoInfo !== null);
    if (states.length === 0) return [];
    const clearedBefore = ghStore.getClearedAt(workspaceId);
    const dismissOnSuccess = ghStore.getWorkspaceDismissOnSuccess(workspaceId);
    let failed = 0;
    for (const s of states) {
      failed += aggregateRunState(s.runs, clearedBefore, dismissOnSuccess).failed;
    }
    if (failed === 0) return [];
    return [{ id: "gh-actions-failed", text: String(failed), color: "var(--silo-color-err)" }];
  }

  getDecorationsFor(workspaceId: string): WorkspaceStatusRow[] {
    const states = ghStore.getRepoStates(workspaceId).filter((s) => s.repoInfo !== null);
    if (states.length === 0) return [];

    const clearedBefore = ghStore.getClearedAt(workspaceId);
    const dismissOnSuccess = ghStore.getWorkspaceDismissOnSuccess(workspaceId);
    let failed = 0, running = 0;
    let mostRecentFailed: WorkflowRun | undefined;
    for (const s of states) {
      const agg = aggregateRunState(s.runs, clearedBefore, dismissOnSuccess);
      failed += agg.failed;
      running += agg.running;
      const top = selectFailedRuns(s.runs, clearedBefore, dismissOnSuccess)[0];
      if (top && (!mostRecentFailed || new Date(top.created_at) > new Date(mostRecentFailed.created_at))) {
        mostRecentFailed = top;
      }
    }

    if (failed > 0) {
      return [{
        id: "gh-actions",
        status: "error",
        label: failed === 1 ? "1 workflow failed" : `${failed} workflows failed`,
        startedAt: mostRecentFailed?.created_at,
      }];
    }

    if (running > 0) {
      return [{ id: "gh-actions", status: "busy", label: running === 1 ? "1 workflow running" : `${running} workflows running` }];
    }

    return [];
  }

  getStatusBarState(): StatusBarState {
    if (!ghStore.initialized) return { kind: "hidden" };
    if (ghStore.authState === "deferred") return { kind: "checking" };
    if (ghStore.authState === "missing") return { kind: "gh-missing" };
    if (ghStore.authState === "unauthenticated") return { kind: "unauthenticated" };
    if (!this._ctx) return { kind: "hidden" };
    const activeId = this._ctx.workspaces.getState().activeId;
    if (!activeId) return { kind: "hidden" };
    return deriveWorkspaceStatusBarState(
      ghStore.getRepoStates(activeId),
      ghStore.getClearedAt(activeId),
      ghStore.getWorkspaceDismissOnSuccess(activeId),
    );
  }

  getTooltipContent(): string {
    const state = this.getStatusBarState();
    if (state.kind !== "ok" || !this._ctx) return getTooltip(state);
    const activeId = this._ctx.workspaces.getState().activeId;
    if (!activeId) return getTooltip(state);
    const states = ghStore.getRepoStates(activeId);
    // Pass primary repo state for rich tooltip (first with a repo info).
    const primary = states.find((s) => s.repoInfo !== null);
    return getRichTooltip(state, primary, ghStore.getClearedAt(activeId), ghStore.getWorkspaceDismissOnSuccess(activeId));
  }

  subscribe(fn: () => void): () => void {
    return ghStore.subscribe(fn);
  }

  dispose(): void {
    for (const id of [...this._timers.keys()]) this._clearTimer(id);
    this._pollingMode.clear();
    this._knownFolders.clear();
    this._lastFetchedAt.clear();
    if (this._authRetryTimer) {
      clearInterval(this._authRetryTimer);
      this._authRetryTimer = null;
    }
    if (this._reconcileDebounceTimer) {
      clearTimeout(this._reconcileDebounceTimer);
      this._reconcileDebounceTimer = null;
    }
    this._wsSub?.dispose();
    this._wsSub = null;
    this._storeUnsub?.();
    this._storeUnsub = null;
  }
}
