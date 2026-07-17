import type { Disposable, ExtensionContext } from "@silo-code/sdk";
import { parseGitHubRemote } from "./parse-remote";
import {
  checkAuth,
  fetchMergedPrs,
  fetchOpenPrs,
  fetchPrDetail,
  fetchViewerLogin,
  probeCwd,
  resolveGhBin,
} from "./github-pr-api";
import { prStore, type WorkspacePrState } from "./store";

const AUTH_RETRY_INTERVAL_MS = 2 * 60_000;
const RECONCILE_DEBOUNCE_MS = 150;
const MIN_FETCH_INTERVAL_MS = 10_000;

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

export class PrService {
  private _timers = new Map<string, ReturnType<typeof setInterval>>();
  private _authRetryTimer: ReturnType<typeof setInterval> | null = null;
  private _reconcileDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _refreshingFolders = new Set<string>();
  private _pollingMode = new Map<string, "active" | "inactive">();
  private _knownFolders = new Map<string, Set<string>>();
  private _lastFetchedAt = new Map<string, number>();
  private _lastFilter = new Map<string, string>();
  private _lastActiveIntervalMs: number | null = null;
  private _lastInactiveIntervalMs: number | null = null;
  private _ctx: ExtensionContext | null = null;
  private _ghBin = "gh";
  private _storeUnsub: (() => void) | null = null;
  private _wsSub: Disposable | null = null;

  async init(ctx: ExtensionContext): Promise<void> {
    this._ctx = ctx;
    ctx.log.info("GitHub PRs extension initializing");
    prStore.hydrate(ctx.storage.global);

    try {
      this._ghBin = await resolveGhBin(ctx);
    } catch (err) {
      ctx.log.debug(`resolveGhBin deferred (${err})`);
      this._ghBin = "gh";
    }

    this._storeUnsub = prStore.subscribe(() => {
      this._applySettingsChange(ctx);
      this._applyEnabledGate(ctx);
      this._applyFilterChange(ctx);
    });

    const authState = await checkAuth(ctx, this._ghBin);
    prStore.setAuthState(authState);

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
          prStore.setAuthState("ok");
          clearInterval(this._authRetryTimer!);
          this._authRetryTimer = null;
          await this._ensureViewerLogin(ctx);
          this._wsSub = ctx.workspaces.subscribe(() => this._scheduleReconcile(ctx));
          this._reconcileWorkspaces(ctx);
        } else {
          prStore.setAuthState(state);
        }
      }, AUTH_RETRY_INTERVAL_MS);
      return;
    }

    await this._ensureViewerLogin(ctx);
    this._reconcileWorkspaces(ctx);
    this._wsSub = ctx.workspaces.subscribe(() => this._scheduleReconcile(ctx));
  }

  private async _ensureViewerLogin(ctx: ExtensionContext): Promise<void> {
    if (prStore.viewerLogin) return;
    const cwd = await probeCwd(ctx);
    const login = await fetchViewerLogin(ctx, cwd, this._ghBin);
    prStore.setViewerLogin(login);
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
        prStore.removeWorkspace(id);
      }
    }

    for (const ws of allOpen) {
      const folders = [ws.folder, ...(ws.extraFolders ?? [])];

      const liveFolderSet = new Set(folders);
      for (const state of prStore.getRepoStates(ws.id)) {
        if (!liveFolderSet.has(state.folder)) {
          ctx.log.debug(`Removing stale folder ${state.folder} from workspace ${ws.id}`);
          prStore.removeFolderState(ws.id, state.folder);
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

      this._lastFilter.set(ws.id, prStore.getWorkspaceFilter(ws.id));

      const becameActive = modeChanged && mode === "active";
      const sinceLastFetch = Date.now() - (this._lastFetchedAt.get(ws.id) ?? 0);
      const activationThrottled = becameActive && sinceLastFetch < MIN_FETCH_INTERVAL_MS;
      const enabled = prStore.getWorkspaceEnabled(ws.id);
      let willFetch = false;
      for (const folder of folders) {
        const isNewFolder = !known.has(folder);
        known.add(folder);
        if (enabled && (isNewFolder || (becameActive && !activationThrottled))) {
          this._refreshFolder(ctx, ws.id, folder);
          willFetch = true;
        }
      }
      if (willFetch) this._lastFetchedAt.set(ws.id, Date.now());
    }
  }

  private _applySettingsChange(ctx: ExtensionContext): void {
    const { activePollIntervalMs, inactivePollIntervalMs } = prStore.settings;
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

  // When the filter flips to "merged", fetch immediately so the panel isn't empty
  // waiting on the next poll tick. Other filter switches are client-side only.
  private _applyFilterChange(ctx: ExtensionContext): void {
    for (const id of this._pollingMode.keys()) {
      const filter = prStore.getWorkspaceFilter(id);
      const prev = this._lastFilter.get(id);
      if (prev === filter) continue;
      this._lastFilter.set(id, filter);
      if (filter === "merged" && prStore.getWorkspaceEnabled(id)) {
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
    if (!prStore.getWorkspaceEnabled(workspaceId)) return;
    const interval = inactive
      ? prStore.settings.inactivePollIntervalMs
      : prStore.settings.activePollIntervalMs;
    this._timers.set(
      workspaceId,
      setInterval(() => {
        if (!prStore.getWorkspaceEnabled(workspaceId)) return;
        const ws = ctx.workspaces.get(workspaceId);
        if (!ws) return;
        this._lastFetchedAt.set(workspaceId, Date.now());
        for (const folder of [ws.folder, ...(ws.extraFolders ?? [])]) {
          this._refreshFolder(ctx, workspaceId, folder);
        }
      }, interval),
    );
  }

  private _applyEnabledGate(ctx: ExtensionContext): void {
    for (const [id, mode] of this._pollingMode) {
      const enabled = prStore.getWorkspaceEnabled(id);
      const hasTimer = this._timers.has(id);
      if (enabled && !hasTimer) this._startPolling(ctx, id, mode === "inactive");
      else if (!enabled && hasTimer) this._clearTimer(id);
    }
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
      if (!prStore.authenticated) {
        ctx.log.debug(`Skipping refresh for workspace ${workspaceId} — not authenticated`);
        prStore.setFolderState(workspaceId, folder, {
          folder,
          repoInfo: null,
          openPrs: [],
          mergedPrs: [],
          lastFetched: null,
          error: { kind: "unauthenticated" },
        });
        return;
      }

      const repoInfo = await resolveRemote(ctx, folder);
      if (!repoInfo) {
        ctx.log.debug(`No GitHub remote found for folder ${folder} in workspace ${workspaceId}`);
        prStore.removeFolderState(workspaceId, folder);
        return;
      }

      const filter = prStore.getWorkspaceFilter(workspaceId);
      const needMerged = filter === "merged";
      ctx.log.debug(`Refreshing PRs for ${repoInfo.owner}/${repoInfo.repo} (${folder})`, { filter });

      const prev = prStore.getRepoStates(workspaceId).find((s) => s.folder === folder);
      const openPromise = fetchOpenPrs(ctx, repoInfo.owner, repoInfo.repo, folder, this._ghBin);
      const mergedPromise = needMerged
        ? fetchMergedPrs(ctx, repoInfo.owner, repoInfo.repo, folder, this._ghBin)
        : Promise.resolve(null);

      const [openResult, mergedResult] = await Promise.all([openPromise, mergedPromise]);

      if (!openResult.ok) {
        ctx.log.warn(`Error fetching open PRs for ${folder}`, { error: openResult.error });
        prStore.setFolderState(workspaceId, folder, {
          folder,
          repoInfo,
          openPrs: prev?.openPrs ?? [],
          mergedPrs: prev?.mergedPrs ?? [],
          lastFetched: prev?.lastFetched ?? null,
          error: { kind: "api-error", error: openResult.error },
        });
        return;
      }

      let mergedPrs = prev?.mergedPrs ?? [];
      if (mergedResult) {
        if (!mergedResult.ok) {
          ctx.log.warn(`Error fetching merged PRs for ${folder}`, { error: mergedResult.error });
          prStore.setFolderState(workspaceId, folder, {
            folder,
            repoInfo,
            openPrs: openResult.prs,
            mergedPrs,
            lastFetched: prev?.lastFetched ?? null,
            error: { kind: "api-error", error: mergedResult.error },
          });
          return;
        }
        mergedPrs = mergedResult.prs;
      }

      const next: WorkspacePrState = {
        folder,
        repoInfo,
        openPrs: openResult.prs,
        mergedPrs,
        lastFetched: new Date(),
        error: null,
      };
      prStore.setFolderState(workspaceId, folder, next);
    } finally {
      this._refreshingFolders.delete(refreshKey);
      this._maybeMarkWorkspaceReady(workspaceId);
    }
  }

  // A workspace is "ready" once every in-flight folder probe for it has
  // settled — including the case where every folder had no GitHub remote and
  // left no folder state behind.
  private _maybeMarkWorkspaceReady(workspaceId: string): void {
    const prefix = `${workspaceId}:`;
    for (const key of this._refreshingFolders) {
      if (key.startsWith(prefix)) return;
    }
    prStore.markWorkspaceReady(workspaceId);
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
    const ws = this._ctx.workspaces.get(workspaceId);
    if (!ws) return;
    this._lastFetchedAt.set(workspaceId, Date.now());
    const folders = [ws.folder, ...(ws.extraFolders ?? [])];
    await Promise.all(
      folders.map((folder) => this._refreshFolder(this._ctx!, workspaceId, folder)),
    );
    this._maybeMarkWorkspaceReady(workspaceId);
  }

  async fetchDetail(folder: string, number: number): Promise<void> {
    if (!this._ctx || !prStore.authenticated) return;
    // Resolve by folder across open workspaces so a mid-fetch workspace switch
    // doesn't drop the request.
    let repoInfo: { owner: string; repo: string } | null = null;
    for (const ws of this._ctx.workspaces.getState().open) {
      const state = prStore.getRepoStates(ws.id).find((s) => s.folder === folder);
      if (state?.repoInfo) {
        repoInfo = state.repoInfo;
        break;
      }
    }
    if (!repoInfo) return;

    prStore.clearDetailError(folder, number);
    const result = await fetchPrDetail(
      this._ctx,
      repoInfo.owner,
      repoInfo.repo,
      number,
      folder,
      this._ghBin,
    );
    if (result.ok) {
      prStore.setDetail(folder, number, result.detail);
    } else {
      this._ctx.log.warn(`Failed to fetch PR detail #${number}`, { error: result.error });
      prStore.setDetailError(folder, number, result.error);
    }
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
