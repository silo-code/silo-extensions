import type { ExtensionStorage } from "@silo-code/sdk";
import type { AuthState, GitHubApiError, PrDetail, PrListItem } from "./github-pr-api";
import { DEFAULT_FILTER, type PrFilter } from "./filters";

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface PrSettings {
  activePollIntervalMs: number;
  inactivePollIntervalMs: number;
}

const DEFAULTS: PrSettings = {
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

export type WorkspacePrError =
  | { kind: "unauthenticated" }
  | { kind: "api-error"; error: GitHubApiError }
  | { kind: "no-repo" };

export interface WorkspacePrState {
  /** Folders in this workspace that share this remote (worktrees included). */
  folders: CheckoutFolder[];
  repoInfo: RepoInfo | null;
  openPrs: PrListItem[];
  mergedPrs: PrListItem[];
  lastFetched: Date | null;
  error: WorkspacePrError | null;
}

export function repoStateKey(owner: string, repo: string): string {
  return `${owner}/${repo}`;
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

// ─── Detail cache ─────────────────────────────────────────────────────────────

export interface DetailCacheEntry {
  detail: PrDetail;
  fetchedAt: Date;
}

export interface DetailErrorEntry {
  error: GitHubApiError;
  fetchedAt: Date;
}

function detailKey(repoKey: string, number: number): string {
  return `${repoKey}:${number}`;
}

// ─── Store ────────────────────────────────────────────────────────────────────

type Listener = () => void;

export class PrStore {
  private _settings: PrSettings = { ...DEFAULTS };
  // Key: `${workspaceId}:${owner}/${repo}` — one entry per unique remote.
  private _repoStates = new Map<string, WorkspacePrState>();
  private _detailCache = new Map<string, DetailCacheEntry>();
  private _detailErrors = new Map<string, DetailErrorEntry>();
  private _workspaceEnabled = new Map<string, boolean>();
  private _workspaceFilter = new Map<string, PrFilter>();
  private _authState: AuthState | null = null;
  private _viewerLogin: string | null = null;
  private _initialized = false;
  // Workspaces that have finished at least one full remote probe. Until then,
  // an empty repo list means "still loading", not "no GitHub remotes".
  private _workspaceReady = new Set<string>();
  private _storage: ExtensionStorage | null = null;
  private _listeners = new Set<Listener>();

  get settings(): PrSettings {
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

  get viewerLogin(): string | null {
    return this._viewerLogin;
  }

  getRepoStates(workspaceId: string): WorkspacePrState[] {
    const prefix = `${workspaceId}:`;
    const result: WorkspacePrState[] = [];
    for (const [key, state] of this._repoStates) {
      if (key.startsWith(prefix)) result.push(state);
    }
    return result;
  }

  hydrate(storage: ExtensionStorage): void {
    this._storage = storage;
    const savedEnabled = storage.get<Record<string, boolean>>("workspaceEnabled") ?? {};
    for (const [id, val] of Object.entries(savedEnabled)) {
      this._workspaceEnabled.set(id, val);
    }
    const savedFilter = storage.get<Record<string, PrFilter>>("workspaceFilter") ?? {};
    for (const [id, val] of Object.entries(savedFilter)) {
      this._workspaceFilter.set(id, val);
    }
    const apply = (): void => {
      const saved = storage.get<Partial<PrSettings>>("settings") ?? {};
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

  setViewerLogin(login: string | null): void {
    this._viewerLogin = login;
    this._notify();
  }

  updateSettings(patch: Partial<PrSettings>): void {
    this._settings = { ...this._settings, ...patch };
    this._storage?.set("settings", this._settings);
    this._notify();
  }

  setRepoState(workspaceId: string, owner: string, repo: string, state: WorkspacePrState): void {
    this._repoStates.set(`${workspaceId}:${repoStateKey(owner, repo)}`, state);
    this._notify();
  }

  removeRepoState(workspaceId: string, owner: string, repo: string): void {
    if (this._repoStates.delete(`${workspaceId}:${repoStateKey(owner, repo)}`)) this._notify();
  }

  removeWorkspace(workspaceId: string): void {
    const prefix = `${workspaceId}:`;
    let changed = false;
    for (const key of this._repoStates.keys()) {
      if (key.startsWith(prefix)) { this._repoStates.delete(key); changed = true; }
    }
    if (this._workspaceReady.delete(workspaceId)) changed = true;
    if (changed) this._notify();
  }

  isWorkspaceReady(workspaceId: string): boolean {
    return this._workspaceReady.has(workspaceId);
  }

  markWorkspaceReady(workspaceId: string): void {
    if (this._workspaceReady.has(workspaceId)) return;
    this._workspaceReady.add(workspaceId);
    this._notify();
  }

  getDetail(repoKey: string, number: number): DetailCacheEntry | undefined {
    return this._detailCache.get(detailKey(repoKey, number));
  }

  getDetailError(repoKey: string, number: number): DetailErrorEntry | undefined {
    return this._detailErrors.get(detailKey(repoKey, number));
  }

  setDetail(repoKey: string, number: number, detail: PrDetail): void {
    const key = detailKey(repoKey, number);
    this._detailCache.set(key, { detail, fetchedAt: new Date() });
    this._detailErrors.delete(key);
    this._notify();
  }

  setDetailError(repoKey: string, number: number, error: GitHubApiError): void {
    this._detailErrors.set(detailKey(repoKey, number), { error, fetchedAt: new Date() });
    this._notify();
  }

  clearDetailError(repoKey: string, number: number): void {
    if (this._detailErrors.delete(detailKey(repoKey, number))) this._notify();
  }

  // Defaults true (opt-out) — same rationale as github-actions: monitoring
  // every detected repo is the expected behavior until a user opts out.
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

  getWorkspaceFilter(workspaceId: string): PrFilter {
    return this._workspaceFilter.get(workspaceId) ?? DEFAULT_FILTER;
  }

  setWorkspaceFilter(workspaceId: string, value: PrFilter): void {
    this._workspaceFilter.set(workspaceId, value);
    const record: Record<string, PrFilter> = {};
    for (const [id, val] of this._workspaceFilter) {
      record[id] = val;
    }
    this._storage?.set("workspaceFilter", record);
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

export const prStore = new PrStore();
