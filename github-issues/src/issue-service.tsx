import type { Disposable, ExtensionContext } from "@silo-code/sdk";
import { parseGitHubRemote } from "./parse-remote";
import {
  checkAuth,
  closeIssue as closeIssueApi,
  fetchClosedIssues,
  fetchIssueDetail,
  fetchOpenIssues,
  fetchViewerLogin,
  probeCwd,
  reopenIssue as reopenIssueApi,
  resolveGhBin,
  type CloseReason,
} from "./github-issue-api";
import {
  issueStore,
  preferredFetchCwd,
  repoStateKey,
  type CheckoutFolder,
  type WorkspaceIssueState,
} from "./store";

const AUTH_RETRY_INTERVAL_MS = 2 * 60_000;
const RECONCILE_DEBOUNCE_MS = 150;
const MIN_FETCH_INTERVAL_MS = 10_000;
const ACTIVE_POLL_MS = 60_000;
const INACTIVE_POLL_MS = 10 * 60_000;

/** Auth-retry interval — also used in user-facing gate copy. */
export const AUTH_RETRY_MINUTES = AUTH_RETRY_INTERVAL_MS / 60_000;

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

interface ResolvedCheckout {
  path: string;
  repoInfo: { owner: string; repo: string };
}

function groupByRemote(
  checkouts: ResolvedCheckout[],
): Map<string, { repoInfo: { owner: string; repo: string }; folders: CheckoutFolder[] }> {
  const byRemote = new Map<string, { repoInfo: { owner: string; repo: string }; folders: CheckoutFolder[] }>();
  for (const c of checkouts) {
    const key = repoStateKey(c.repoInfo.owner, c.repoInfo.repo);
    let group = byRemote.get(key);
    if (!group) {
      group = { repoInfo: c.repoInfo, folders: [] };
      byRemote.set(key, group);
    }
    group.folders.push({ path: c.path });
  }
  return byRemote;
}

export class IssueService {
  private _timers = new Map<string, ReturnType<typeof setInterval>>();
  private _authRetryTimer: ReturnType<typeof setInterval> | null = null;
  private _reconcileDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  // Key: `${workspaceId}:${owner}/${repo}` — prevents concurrent refreshes per remote.
  private _refreshingRepos = new Set<string>();
  private _pollingMode = new Map<string, "active" | "inactive">();
  private _knownFolders = new Map<string, Set<string>>();
  private _lastFetchedAt = new Map<string, number>();
  private _lastFilter = new Map<string, string>();
  private _ctx: ExtensionContext | null = null;
  private _ghBin = "gh";
  private _storeUnsub: (() => void) | null = null;
  private _wsSub: Disposable | null = null;

  async init(ctx: ExtensionContext): Promise<void> {
    this._ctx = ctx;
    ctx.log.info("GitHub Issues extension initializing");
    issueStore.hydrate(ctx.storage.global);

    try {
      this._ghBin = await resolveGhBin(ctx);
    } catch (err) {
      ctx.log.debug(`resolveGhBin deferred (${err})`);
      this._ghBin = "gh";
    }

    this._storeUnsub = issueStore.subscribe(() => {
      this._applyEnabledGate(ctx);
      this._applyFilterChange(ctx);
    });

    const authState = await checkAuth(ctx, this._ghBin);
    issueStore.setAuthState(authState);

    if (authState !== "ok") {
      if (authState === "deferred") {
        ctx.log.info(`Auth check deferred (no usable cwd yet) — will retry every ${AUTH_RETRY_INTERVAL_MS / 1000}s`);
      } else {
        const reason = authState === "missing" ? "gh CLI not found" : "not authenticated";
        ctx.log.warn(`${reason} — will retry every ${AUTH_RETRY_INTERVAL_MS / 1000}s`);
      }
      this._authRetryTimer = setInterval(async () => {
        try {
          this._ghBin = await resolveGhBin(ctx);
        } catch {
          /* keep previous _ghBin */
        }
        const state = await checkAuth(ctx, this._ghBin);
        if (state === "ok") {
          ctx.log.info("Authentication succeeded — starting workspace polling");
          issueStore.setAuthState("ok");
          clearInterval(this._authRetryTimer!);
          this._authRetryTimer = null;
          await this._ensureViewerLogin(ctx);
          this._wsSub = ctx.workspaces.subscribe(() => this._scheduleReconcile(ctx));
          this._reconcileWorkspaces(ctx);
        } else {
          issueStore.setAuthState(state);
        }
      }, AUTH_RETRY_INTERVAL_MS);
      return;
    }

    await this._ensureViewerLogin(ctx);
    this._reconcileWorkspaces(ctx);
    this._wsSub = ctx.workspaces.subscribe(() => this._scheduleReconcile(ctx));
  }

  private async _ensureViewerLogin(ctx: ExtensionContext): Promise<void> {
    if (issueStore.viewerLogin) return;
    const cwd = await probeCwd(ctx);
    const login = await fetchViewerLogin(ctx, cwd, this._ghBin);
    issueStore.setViewerLogin(login);
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

    const liveIds = new Set(allOpen.map((w) => w.id));
    for (const id of [...this._pollingMode.keys()]) {
      if (!liveIds.has(id)) {
        ctx.log.debug(`Removing closed workspace: ${id}`);
        this._clearTimer(id);
        this._pollingMode.delete(id);
        this._knownFolders.delete(id);
        this._lastFilter.delete(id);
        issueStore.removeWorkspace(id);
      }
    }

    for (const ws of allOpen) {
      const folders = [ws.folder, ...(ws.extraFolders ?? [])];

      const liveFolderSet = new Set(folders);
      for (const state of issueStore.getRepoStates(ws.id)) {
        if (!state.repoInfo) continue;
        const remaining = state.folders.filter((f) => liveFolderSet.has(f.path));
        if (remaining.length === 0) {
          ctx.log.debug(`Removing stale remote ${state.repoInfo.owner}/${state.repoInfo.repo} from workspace ${ws.id}`);
          issueStore.removeRepoState(ws.id, state.repoInfo.owner, state.repoInfo.repo);
        } else if (remaining.length !== state.folders.length) {
          issueStore.setRepoState(ws.id, state.repoInfo.owner, state.repoInfo.repo, {
            ...state,
            folders: remaining,
          });
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

      this._lastFilter.set(ws.id, issueStore.getWorkspaceFilter(ws.id));

      const becameActive = modeChanged && mode === "active";
      const sinceLastFetch = Date.now() - (this._lastFetchedAt.get(ws.id) ?? 0);
      const activationThrottled = becameActive && sinceLastFetch < MIN_FETCH_INTERVAL_MS;
      const enabled = issueStore.getWorkspaceEnabled(ws.id);
      let willFetch = false;
      for (const folder of folders) {
        const isNewFolder = !known.has(folder);
        known.add(folder);
        if (enabled && (isNewFolder || (becameActive && !activationThrottled))) {
          willFetch = true;
        }
      }
      if (willFetch) {
        this._refreshWorkspaceRepos(ctx, ws.id);
        this._lastFetchedAt.set(ws.id, Date.now());
      }
    }
  }

  // When the filter flips to "closed", fetch immediately so the panel isn't
  // empty waiting on the next poll tick. Other filter switches are
  // client-side only.
  private _applyFilterChange(ctx: ExtensionContext): void {
    for (const id of this._pollingMode.keys()) {
      const filter = issueStore.getWorkspaceFilter(id);
      const prev = this._lastFilter.get(id);
      if (prev === filter) continue;
      this._lastFilter.set(id, filter);
      if (filter === "closed" && issueStore.getWorkspaceEnabled(id)) {
        void this.refreshWorkspace(id);
      }
    }
  }

  private _startPolling(
    ctx: ExtensionContext,
    workspaceId: string,
    inactive: boolean,
  ): void {
    this._clearTimer(workspaceId);
    if (!issueStore.getWorkspaceEnabled(workspaceId)) return;
    const interval = inactive ? INACTIVE_POLL_MS : ACTIVE_POLL_MS;
    this._timers.set(
      workspaceId,
      setInterval(() => {
        if (!issueStore.getWorkspaceEnabled(workspaceId)) return;
        if (!ctx.workspaces.get(workspaceId)) return;
        this._lastFetchedAt.set(workspaceId, Date.now());
        this._refreshWorkspaceRepos(ctx, workspaceId);
      }, interval),
    );
  }

  private _applyEnabledGate(ctx: ExtensionContext): void {
    for (const [id, mode] of this._pollingMode) {
      const enabled = issueStore.getWorkspaceEnabled(id);
      const hasTimer = this._timers.has(id);
      if (enabled && !hasTimer) this._startPolling(ctx, id, mode === "inactive");
      else if (!enabled && hasTimer) this._clearTimer(id);
    }
  }

  /** Resolve all workspace folders, group by remote, fetch each remote once. */
  private async _refreshWorkspaceRepos(
    ctx: ExtensionContext,
    workspaceId: string,
  ): Promise<void> {
    const ws = ctx.workspaces.get(workspaceId);
    if (!ws) return;

    issueStore.setWorkspaceRefreshing(workspaceId, true);
    try {
      if (!issueStore.authenticated) {
        ctx.log.debug(`Skipping refresh for workspace ${workspaceId} — not authenticated`);
        this._maybeMarkWorkspaceReady(workspaceId);
        return;
      }

      const folderPaths = [ws.folder, ...(ws.extraFolders ?? [])];
      const resolved = await Promise.all(
        folderPaths.map(async (path) => {
          const repoInfo = await resolveRemote(ctx, path);
          if (!repoInfo) return null;
          return { path, repoInfo } satisfies ResolvedCheckout;
        }),
      );
      const checkouts = resolved.filter((c): c is ResolvedCheckout => c !== null);
      const byRemote = groupByRemote(checkouts);

      for (const state of issueStore.getRepoStates(workspaceId)) {
        if (!state.repoInfo) continue;
        const key = repoStateKey(state.repoInfo.owner, state.repoInfo.repo);
        if (!byRemote.has(key)) {
          issueStore.removeRepoState(workspaceId, state.repoInfo.owner, state.repoInfo.repo);
        }
      }

      await Promise.all(
        [...byRemote.values()].map((group) =>
          this._refreshRemote(ctx, workspaceId, ws.folder, group.repoInfo, group.folders),
        ),
      );
      this._maybeMarkWorkspaceReady(workspaceId);
    } finally {
      issueStore.setWorkspaceRefreshing(workspaceId, false);
    }
  }

  private async _refreshRemote(
    ctx: ExtensionContext,
    workspaceId: string,
    primaryFolder: string,
    repoInfo: { owner: string; repo: string },
    folders: CheckoutFolder[],
  ): Promise<void> {
    const refreshKey = `${workspaceId}:${repoStateKey(repoInfo.owner, repoInfo.repo)}`;
    if (this._refreshingRepos.has(refreshKey)) {
      ctx.log.debug(`Skipping refresh for ${refreshKey} — fetch already in flight`);
      return;
    }
    this._refreshingRepos.add(refreshKey);
    try {
      const cwd = preferredFetchCwd(primaryFolder, folders);
      const filter = issueStore.getWorkspaceFilter(workspaceId);
      const needClosed = filter === "closed";
      ctx.log.debug(
        `Refreshing issues for ${repoInfo.owner}/${repoInfo.repo} (${folders.length} checkout(s))`,
        { filter, cwd },
      );

      const prev = issueStore.getRepoStates(workspaceId).find(
        (s) => s.repoInfo?.owner === repoInfo.owner && s.repoInfo?.repo === repoInfo.repo,
      );
      const openPromise = fetchOpenIssues(ctx, repoInfo.owner, repoInfo.repo, cwd, this._ghBin);
      const closedPromise = needClosed
        ? fetchClosedIssues(ctx, repoInfo.owner, repoInfo.repo, cwd, this._ghBin)
        : Promise.resolve(null);

      const [openResult, closedResult] = await Promise.all([openPromise, closedPromise]);

      if (!openResult.ok) {
        ctx.log.warn(`Error fetching open issues for ${repoInfo.owner}/${repoInfo.repo}`, { error: openResult.error });
        issueStore.setRepoState(workspaceId, repoInfo.owner, repoInfo.repo, {
          folders,
          repoInfo,
          openIssues: prev?.openIssues ?? [],
          closedIssues: prev?.closedIssues ?? [],
          lastFetched: prev?.lastFetched ?? null,
          error: { kind: "api-error", error: openResult.error },
        });
        return;
      }

      let closedIssues = prev?.closedIssues ?? [];
      if (closedResult) {
        if (!closedResult.ok) {
          ctx.log.warn(`Error fetching closed issues for ${repoInfo.owner}/${repoInfo.repo}`, { error: closedResult.error });
          issueStore.setRepoState(workspaceId, repoInfo.owner, repoInfo.repo, {
            folders,
            repoInfo,
            openIssues: openResult.issues,
            closedIssues,
            lastFetched: prev?.lastFetched ?? null,
            error: { kind: "api-error", error: closedResult.error },
          });
          return;
        }
        closedIssues = closedResult.issues;
      }

      const next: WorkspaceIssueState = {
        folders,
        repoInfo,
        openIssues: openResult.issues,
        closedIssues,
        lastFetched: new Date(),
        error: null,
      };
      issueStore.setRepoState(workspaceId, repoInfo.owner, repoInfo.repo, next);
    } finally {
      this._refreshingRepos.delete(refreshKey);
    }
  }

  // A workspace is "ready" once every in-flight remote probe for it has
  // settled — including the case where every folder had no GitHub remote and
  // left no repo state behind.
  private _maybeMarkWorkspaceReady(workspaceId: string): void {
    const prefix = `${workspaceId}:`;
    for (const key of this._refreshingRepos) {
      if (key.startsWith(prefix)) return;
    }
    issueStore.markWorkspaceReady(workspaceId);
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

  async refreshWorkspace(workspaceId: string): Promise<void> {
    if (!this._ctx) return;
    this._lastFetchedAt.set(workspaceId, Date.now());
    await this._refreshWorkspaceRepos(this._ctx, workspaceId);
  }

  async fetchDetail(repoKey: string, number: number): Promise<void> {
    if (!this._ctx || !issueStore.authenticated) return;
    const resolved = this._resolveRepo(repoKey);
    if (!resolved) return;

    issueStore.clearDetailError(repoKey, number);
    const result = await fetchIssueDetail(
      this._ctx,
      resolved.repoInfo.owner,
      resolved.repoInfo.repo,
      number,
      resolved.cwd,
      this._ghBin,
    );
    if (result.ok) {
      issueStore.setDetail(repoKey, number, result.detail);
    } else {
      this._ctx.log.warn(`Failed to fetch issue detail #${number}`, { error: result.error });
      issueStore.setDetailError(repoKey, number, result.error);
    }
  }

  /** Resolve a collapsed remote by owner/repo across open workspaces. */
  private _resolveRepo(repoKey: string): {
    repoInfo: { owner: string; repo: string };
    folders: CheckoutFolder[];
    cwd: string;
  } | null {
    if (!this._ctx) return null;
    for (const ws of this._ctx.workspaces.getState().open) {
      const state = issueStore.getRepoStates(ws.id).find(
        (s) => s.repoInfo && repoStateKey(s.repoInfo.owner, s.repoInfo.repo) === repoKey,
      );
      if (state?.repoInfo && state.folders.length > 0) {
        return {
          repoInfo: state.repoInfo,
          folders: state.folders,
          cwd: preferredFetchCwd(ws.folder, state.folders),
        };
      }
    }
    return null;
  }

  async closeIssue(
    workspaceId: string,
    repoKey: string,
    number: number,
    reason: CloseReason,
  ) {
    if (!this._ctx || !issueStore.authenticated) {
      return {
        ok: false as const,
        error: { kind: "unauthenticated" as const, message: "Not authenticated" },
      };
    }
    const resolved = this._resolveRepo(repoKey);
    if (!resolved) {
      return {
        ok: false as const,
        error: { kind: "not-found" as const, message: "Repository not found for this workspace" },
      };
    }
    const result = await closeIssueApi(
      this._ctx,
      resolved.repoInfo.owner,
      resolved.repoInfo.repo,
      number,
      reason,
      resolved.cwd,
      this._ghBin,
    );
    // Refresh list + detail whether we succeeded or failed so the UI catches
    // up after a race or a successful close.
    await this.refreshWorkspace(workspaceId);
    await this.fetchDetail(repoKey, number);
    return result;
  }

  async reopenIssue(workspaceId: string, repoKey: string, number: number) {
    if (!this._ctx || !issueStore.authenticated) {
      return {
        ok: false as const,
        error: { kind: "unauthenticated" as const, message: "Not authenticated" },
      };
    }
    const resolved = this._resolveRepo(repoKey);
    if (!resolved) {
      return {
        ok: false as const,
        error: { kind: "not-found" as const, message: "Repository not found for this workspace" },
      };
    }
    const result = await reopenIssueApi(
      this._ctx,
      resolved.repoInfo.owner,
      resolved.repoInfo.repo,
      number,
      resolved.cwd,
      this._ghBin,
    );
    await this.refreshWorkspace(workspaceId);
    await this.fetchDetail(repoKey, number);
    return result;
  }

  dispose(): void {
    for (const id of [...this._timers.keys()]) this._clearTimer(id);
    this._pollingMode.clear();
    this._knownFolders.clear();
    this._lastFetchedAt.clear();
    this._lastFilter.clear();
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
