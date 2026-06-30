import type { ExtensionStorage } from "@silo-code/sdk";
import type { WorkflowRun, GitHubApiError, AuthState } from "./github-api";

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface GhActionsSettings {
  activePollIntervalMs: number;
  inactivePollIntervalMs: number;
  /** When true, only show failures on the workspace's current branch. Default: false (all branches). */
  currentBranchOnly: boolean;
}

const DEFAULTS: GhActionsSettings = {
  activePollIntervalMs: 60_000,
  inactivePollIntervalMs: 10 * 60_000,
  currentBranchOnly: false,
};

// ─── Per-workspace state ──────────────────────────────────────────────────────

export interface RepoInfo {
  owner: string;
  repo: string;
}

export type WorkspaceError =
  | { kind: "unauthenticated" }
  | { kind: "api-error"; error: GitHubApiError }
  | { kind: "no-repo" };

export interface WorkspaceGhState {
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

// ─── Store ────────────────────────────────────────────────────────────────────

type Listener = () => void;

export class GhActionsStore {
  private _settings: GhActionsSettings = { ...DEFAULTS };
  private _workspaces = new Map<string, WorkspaceGhState>();
  private _workspaceClearedAt = new Map<string, Date>();
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

  get workspaces(): ReadonlyMap<string, WorkspaceGhState> {
    return this._workspaces;
  }

  hydrate(storage: ExtensionStorage): void {
    this._storage = storage;
    // Load persisted cleared-at timestamps
    const saved_cleared = storage.get<Record<string, string>>("workspaceClearedAt") ?? {};
    for (const [id, iso] of Object.entries(saved_cleared)) {
      this._workspaceClearedAt.set(id, new Date(iso));
    }
    const apply = (): void => {
      const saved = storage.get<Partial<GhActionsSettings>>("settings") ?? {};
      this._settings = {
        activePollIntervalMs: saved.activePollIntervalMs ?? DEFAULTS.activePollIntervalMs,
        inactivePollIntervalMs: saved.inactivePollIntervalMs ?? DEFAULTS.inactivePollIntervalMs,
        currentBranchOnly: saved.currentBranchOnly ?? DEFAULTS.currentBranchOnly,
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

  /** @deprecated use setAuthState */
  setAuthenticated(value: boolean): void {
    this.setAuthState(value ? "ok" : "unauthenticated");
  }

  updateSettings(patch: Partial<GhActionsSettings>): void {
    this._settings = { ...this._settings, ...patch };
    this._storage?.set("settings", this._settings);
    this._notify();
  }

  setWorkspaceState(workspaceId: string, state: WorkspaceGhState): void {
    this._workspaces.set(workspaceId, state);
    this._notify();
  }

  removeWorkspace(workspaceId: string): void {
    if (this._workspaces.delete(workspaceId)) this._notify();
  }

  getClearedAt(workspaceId: string): Date | undefined {
    return this._workspaceClearedAt.get(workspaceId);
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
