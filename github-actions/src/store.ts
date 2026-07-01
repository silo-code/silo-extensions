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

// ─── Per-folder state ─────────────────────────────────────────────────────────

export interface RepoInfo {
  owner: string;
  repo: string;
}

export type WorkspaceError =
  | { kind: "unauthenticated" }
  | { kind: "api-error"; error: GitHubApiError }
  | { kind: "no-repo" };

export interface WorkspaceGhState {
  folder: string;
  repoInfo: RepoInfo | null;
  branch: string | null;
  runs: WorkflowRun[];
  lastFetched: Date | null;
  error: WorkspaceError | null;
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

// Failed runs that haven't been cleared, newest first. Shared by the modal list
// and the workspace decoration so both apply identical filtering.
export function selectFailedRuns(runs: WorkflowRun[], clearedBefore?: Date): WorkflowRun[] {
  return runs
    .filter(
      (r) =>
        r.status === "completed" &&
        r.conclusion === "failure" &&
        (!clearedBefore || new Date(r.created_at) > clearedBefore),
    )
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export function selectRunningRuns(runs: WorkflowRun[]): WorkflowRun[] {
  return runs.filter((r) => r.status === "in_progress" || r.status === "queued");
}

export function aggregateRunState(runs: WorkflowRun[], clearedBefore?: Date): { failed: number; running: number } {
  // Count distinct workflows with any failure run that isn't cleared.
  // Running counts all in-progress/queued runs regardless of clear state.
  const failedWorkflows = new Set<string>();
  let running = 0;
  for (const run of runs) {
    if (run.status === "in_progress" || run.status === "queued") {
      running++;
    } else if (run.status === "completed" && run.conclusion === "failure") {
      if (!clearedBefore || new Date(run.created_at) > clearedBefore) {
        failedWorkflows.add(run.name);
      }
    }
  }
  return { failed: failedWorkflows.size, running };
}

export function deriveStatusBarState(ws: WorkspaceGhState | undefined, clearedBefore?: Date): StatusBarState {
  if (!ws) return { kind: "checking" };
  if (ws.error?.kind === "unauthenticated") return { kind: "unauthenticated" };
  if (ws.error?.kind === "no-repo") return { kind: "no-repo" };
  if (ws.error?.kind === "api-error") return { kind: "api-error", message: ws.error.error.message };
  if (!ws.repoInfo) return { kind: "checking" };

  const { failed, running } = aggregateRunState(ws.runs, clearedBefore);
  return { kind: "ok", failed, running };
}

// Aggregates status across all folder states in a workspace.
export function deriveWorkspaceStatusBarState(
  states: WorkspaceGhState[],
  clearedBefore?: Date,
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
    const agg = aggregateRunState(s.runs, clearedBefore);
    failed += agg.failed;
    running += agg.running;
  }
  return { kind: "ok", failed, running };
}

// ─── Store ────────────────────────────────────────────────────────────────────

type Listener = () => void;

export class GhActionsStore {
  private _settings: GhActionsSettings = { ...DEFAULTS };
  // Key: `${workspaceId}:${folder}` — one entry per (workspace, folder) pair.
  private _folderStates = new Map<string, WorkspaceGhState>();
  private _workspaceClearedAt = new Map<string, Date>();
  private _workspaceCurrentBranchOnly = new Map<string, boolean>();
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
    for (const [key, state] of this._folderStates) {
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

  setFolderState(workspaceId: string, folder: string, state: WorkspaceGhState): void {
    this._folderStates.set(`${workspaceId}:${folder}`, state);
    this._notify();
  }

  removeFolderState(workspaceId: string, folder: string): void {
    if (this._folderStates.delete(`${workspaceId}:${folder}`)) this._notify();
  }

  clearWorkspaceRuns(workspaceId: string): void {
    const prefix = `${workspaceId}:`;
    let changed = false;
    for (const [key, state] of this._folderStates) {
      if (key.startsWith(prefix)) {
        this._folderStates.set(key, { ...state, runs: [], lastFetched: null });
        changed = true;
      }
    }
    if (changed) this._notify();
  }

  removeWorkspace(workspaceId: string): void {
    const prefix = `${workspaceId}:`;
    let changed = false;
    for (const key of this._folderStates.keys()) {
      if (key.startsWith(prefix)) { this._folderStates.delete(key); changed = true; }
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
