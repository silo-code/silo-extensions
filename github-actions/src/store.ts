import type { ExtensionStorage } from "@silo-code/sdk";
import type { WorkflowRun, GitHubApiError, AuthState } from "./github-api";

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface GhActionsSettings {
  activePollIntervalMs: number;
  inactivePollIntervalMs: number;
}

const DEFAULTS: GhActionsSettings = {
  activePollIntervalMs: 60_000,
  inactivePollIntervalMs: 10 * 60_000,
};

// ─── Per-repo state (collapsed across worktree folders) ───────────────────────

export interface RepoInfo {
  owner: string;
  repo: string;
}

/** One workspace folder (or worktree) that resolved to this remote. */
export interface CheckoutFolder {
  path: string;
  branch: string;
}

export type WorkspaceError =
  | { kind: "unauthenticated" }
  | { kind: "api-error"; error: GitHubApiError }
  | { kind: "no-repo" };

export interface WorkspaceGhState {
  /** Folders in this workspace that share this remote (worktrees included). */
  folders: CheckoutFolder[];
  repoInfo: RepoInfo | null;
  runs: WorkflowRun[];
  lastFetched: Date | null;
  error: WorkspaceError | null;
}

export function repoStateKey(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

export function monitoredBranches(state: WorkspaceGhState): string[] {
  return [...new Set(state.folders.map((f) => f.branch))];
}

/** Compact branch list for headers: `a · b · c` or `a · b · c +2`. */
export function formatBranchList(branches: string[], maxVisible = 3): string {
  const unique = [...new Set(branches)];
  if (unique.length === 0) return "";
  if (unique.length <= maxVisible) return unique.join(" · ");
  return `${unique.slice(0, maxVisible).join(" · ")} +${unique.length - maxVisible}`;
}

/** Prefer the workspace primary folder when it belongs to this remote. */
export function preferredFetchCwd(
  primaryFolder: string | undefined,
  folders: CheckoutFolder[],
): string {
  if (primaryFolder && folders.some((f) => f.path === primaryFolder)) {
    return primaryFolder;
  }
  return folders[0]!.path;
}

/** Prefer a folder whose HEAD matches the run's branch; else fetch cwd. */
export function preferredRerunCwd(
  primaryFolder: string | undefined,
  folders: CheckoutFolder[],
  headBranch: string,
): string {
  const match = folders.find((f) => f.branch === headBranch);
  if (match) return match.path;
  return preferredFetchCwd(primaryFolder, folders);
}

// ─── Aggregated status bar state ──────────────────────────────────────────────

export type StatusBarState =
  | { kind: "hidden" }
  | { kind: "checking" }
  | { kind: "no-repo" }
  | { kind: "gh-missing" }
  | { kind: "unauthenticated" }
  | { kind: "api-error"; message: string }
  | { kind: "ok"; failed: number; running: number };

// Builds a name → latest-success-date map used by dismissOnSuccess filtering.
function buildLatestSuccessMap(runs: WorkflowRun[]): Map<string, Date> {
  const map = new Map<string, Date>();
  for (const r of runs) {
    if (r.status === "completed" && r.conclusion === "success") {
      const t = new Date(r.created_at);
      const prev = map.get(r.name);
      if (!prev || t > prev) map.set(r.name, t);
    }
  }
  return map;
}

function isDismissedBySuccess(run: WorkflowRun, latestSuccess: Map<string, Date>): boolean {
  const successDate = latestSuccess.get(run.name);
  return !!successDate && successDate >= new Date(run.created_at);
}

// Failed runs that haven't been cleared, newest first. Shared by the modal list
// and the workspace decoration so both apply identical filtering.
export function selectFailedRuns(
  runs: WorkflowRun[],
  clearedBefore?: Date,
  dismissOnSuccess?: boolean,
): WorkflowRun[] {
  const latestSuccess = buildLatestSuccessMap(dismissOnSuccess ? runs : []);
  return runs
    .filter(
      (r) =>
        r.status === "completed" &&
        r.conclusion === "failure" &&
        (!clearedBefore || new Date(r.created_at) > clearedBefore) &&
        !isDismissedBySuccess(r, latestSuccess),
    )
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export function selectRunningRuns(runs: WorkflowRun[]): WorkflowRun[] {
  return runs.filter((r) => r.status === "in_progress" || r.status === "queued");
}

export function aggregateRunState(
  runs: WorkflowRun[],
  clearedBefore?: Date,
  dismissOnSuccess?: boolean,
): { failed: number; running: number } {
  // Count distinct workflows with any failure run that isn't cleared.
  // Running counts all in-progress/queued runs regardless of clear state.
  const latestSuccess = buildLatestSuccessMap(dismissOnSuccess ? runs : []);
  const failedWorkflows = new Set<string>();
  let running = 0;
  for (const run of runs) {
    if (run.status === "in_progress" || run.status === "queued") {
      running++;
    } else if (run.status === "completed" && run.conclusion === "failure") {
      if (
        (!clearedBefore || new Date(run.created_at) > clearedBefore) &&
        !isDismissedBySuccess(run, latestSuccess)
      ) {
        failedWorkflows.add(run.name);
      }
    }
  }
  return { failed: failedWorkflows.size, running };
}

export function deriveStatusBarState(
  ws: WorkspaceGhState | undefined,
  clearedBefore?: Date,
  dismissOnSuccess?: boolean,
): StatusBarState {
  if (!ws) return { kind: "checking" };
  if (ws.error?.kind === "unauthenticated") return { kind: "unauthenticated" };
  if (ws.error?.kind === "no-repo") return { kind: "no-repo" };
  if (ws.error?.kind === "api-error") return { kind: "api-error", message: ws.error.error.message };
  if (!ws.repoInfo) return { kind: "checking" };

  const { failed, running } = aggregateRunState(ws.runs, clearedBefore, dismissOnSuccess);
  return { kind: "ok", failed, running };
}

// Aggregates status across all repo states in a workspace.
export function deriveWorkspaceStatusBarState(
  states: WorkspaceGhState[],
  clearedBefore?: Date,
  dismissOnSuccess?: boolean,
): StatusBarState {
  if (states.length === 0) return { kind: "checking" };
  const withRepo = states.filter((s) => s.repoInfo !== null);
  if (withRepo.length === 0) return { kind: "no-repo" };
  const unauth = states.find((s) => s.error?.kind === "unauthenticated");
  if (unauth) return { kind: "unauthenticated" };
  const apiErr = states.find((s) => s.error?.kind === "api-error");
  if (apiErr) return { kind: "api-error", message: (apiErr.error as Extract<WorkspaceError, { kind: "api-error" }>).error.message };
  let failed = 0, running = 0;
  for (const s of withRepo) {
    const agg = aggregateRunState(s.runs, clearedBefore, dismissOnSuccess);
    failed += agg.failed;
    running += agg.running;
  }
  return { kind: "ok", failed, running };
}

// ─── Store ────────────────────────────────────────────────────────────────────

type Listener = () => void;

export class GhActionsStore {
  private _settings: GhActionsSettings = { ...DEFAULTS };
  // Key: `${workspaceId}:${owner}/${repo}` — one entry per unique remote.
  private _repoStates = new Map<string, WorkspaceGhState>();
  private _workspaceClearedAt = new Map<string, Date>();
  private _workspaceCurrentBranchOnly = new Map<string, boolean>();
  private _workspaceDismissOnSuccess = new Map<string, boolean>();
  private _workspaceEnabled = new Map<string, boolean>();
  private _authState: AuthState | null = null;
  private _initialized = false;
  private _storage: ExtensionStorage | null = null;
  private _listeners = new Set<Listener>();

  get settings(): GhActionsSettings {
    return this._settings;
  }

  get authState(): AuthState | null {
    return this._authState;
  }

  get authenticated(): boolean {
    return this._authState === "ok";
  }

  get initialized(): boolean {
    return this._initialized;
  }

  getRepoStates(workspaceId: string): WorkspaceGhState[] {
    const prefix = `${workspaceId}:`;
    const result: WorkspaceGhState[] = [];
    for (const [key, state] of this._repoStates) {
      if (key.startsWith(prefix)) result.push(state);
    }
    return result;
  }

  hydrate(storage: ExtensionStorage): void {
    this._storage = storage;
    const savedClearedAt = storage.get<Record<string, string>>("workspaceClearedAt") ?? {};
    for (const [id, iso] of Object.entries(savedClearedAt)) {
      this._workspaceClearedAt.set(id, new Date(iso));
    }
    const savedBranchOnly = storage.get<Record<string, boolean>>("workspaceCurrentBranchOnly") ?? {};
    for (const [id, val] of Object.entries(savedBranchOnly)) {
      this._workspaceCurrentBranchOnly.set(id, val);
    }
    const savedDismissOnSuccess = storage.get<Record<string, boolean>>("workspaceDismissOnSuccess") ?? {};
    for (const [id, val] of Object.entries(savedDismissOnSuccess)) {
      this._workspaceDismissOnSuccess.set(id, val);
    }
    const savedEnabled = storage.get<Record<string, boolean>>("workspaceEnabled") ?? {};
    for (const [id, val] of Object.entries(savedEnabled)) {
      this._workspaceEnabled.set(id, val);
    }
    const apply = (): void => {
      const saved = storage.get<Partial<GhActionsSettings>>("settings") ?? {};
      this._settings = {
        activePollIntervalMs: saved.activePollIntervalMs ?? DEFAULTS.activePollIntervalMs,
        inactivePollIntervalMs: saved.inactivePollIntervalMs ?? DEFAULTS.inactivePollIntervalMs,
      };
      this._notify();
    };
    apply();
    storage.subscribe(apply);
  }

  setAuthState(state: AuthState): void {
    this._authState = state;
    this._initialized = true;
    this._notify();
  }

  updateSettings(patch: Partial<GhActionsSettings>): void {
    this._settings = { ...this._settings, ...patch };
    this._storage?.set("settings", this._settings);
    this._notify();
  }

  setRepoState(workspaceId: string, owner: string, repo: string, state: WorkspaceGhState): void {
    this._repoStates.set(`${workspaceId}:${repoStateKey(owner, repo)}`, state);
    this._notify();
  }

  removeRepoState(workspaceId: string, owner: string, repo: string): void {
    if (this._repoStates.delete(`${workspaceId}:${repoStateKey(owner, repo)}`)) this._notify();
  }

  clearWorkspaceRuns(workspaceId: string): void {
    const prefix = `${workspaceId}:`;
    let changed = false;
    for (const [key, state] of this._repoStates) {
      if (key.startsWith(prefix)) {
        this._repoStates.set(key, { ...state, runs: [], lastFetched: null });
        changed = true;
      }
    }
    if (changed) this._notify();
  }

  removeWorkspace(workspaceId: string): void {
    const prefix = `${workspaceId}:`;
    let changed = false;
    for (const key of this._repoStates.keys()) {
      if (key.startsWith(prefix)) { this._repoStates.delete(key); changed = true; }
    }
    if (changed) this._notify();
  }

  getClearedAt(workspaceId: string): Date | undefined {
    return this._workspaceClearedAt.get(workspaceId);
  }

  getWorkspaceCurrentBranchOnly(workspaceId: string): boolean {
    return this._workspaceCurrentBranchOnly.get(workspaceId) ?? false;
  }

  setWorkspaceCurrentBranchOnly(workspaceId: string, value: boolean): void {
    this._workspaceCurrentBranchOnly.set(workspaceId, value);
    const record: Record<string, boolean> = {};
    for (const [id, val] of this._workspaceCurrentBranchOnly) {
      record[id] = val;
    }
    this._storage?.set("workspaceCurrentBranchOnly", record);
    this._notify();
  }

  getWorkspaceDismissOnSuccess(workspaceId: string): boolean {
    return this._workspaceDismissOnSuccess.get(workspaceId) ?? false;
  }

  setWorkspaceDismissOnSuccess(workspaceId: string, value: boolean): void {
    this._workspaceDismissOnSuccess.set(workspaceId, value);
    const record: Record<string, boolean> = {};
    for (const [id, val] of this._workspaceDismissOnSuccess) {
      record[id] = val;
    }
    this._storage?.set("workspaceDismissOnSuccess", record);
    this._notify();
  }

  // Defaults true (opt-out), unlike the other two per-workspace booleans
  // (default false / opt-in) — this extension already monitors every
  // detected repo today, so introducing this flag must not silently stop
  // monitoring anywhere until a user explicitly disables it.
  getWorkspaceEnabled(workspaceId: string): boolean {
    return this._workspaceEnabled.get(workspaceId) ?? true;
  }

  setWorkspaceEnabled(workspaceId: string, value: boolean): void {
    this._workspaceEnabled.set(workspaceId, value);
    const record: Record<string, boolean> = {};
    for (const [id, val] of this._workspaceEnabled) {
      record[id] = val;
    }
    this._storage?.set("workspaceEnabled", record);
    this._notify();
  }

  clearAlerts(workspaceId: string): void {
    const now = new Date();
    this._workspaceClearedAt.set(workspaceId, now);
    const record: Record<string, string> = {};
    for (const [id, date] of this._workspaceClearedAt) {
      record[id] = date.toISOString();
    }
    this._storage?.set("workspaceClearedAt", record);
    this._notify();
  }

  subscribe(fn: Listener): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  private _notify(): void {
    this._listeners.forEach((fn) => fn());
  }
}

export const ghStore = new GhActionsStore();
