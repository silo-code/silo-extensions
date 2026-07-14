import type { ExtensionStorage } from "@silo-code/sdk";
import type { CpuSample } from "./metrics";
import type { ProcessesData } from "./processes/model";

// ─── Settings types ────────────────────────────────────────────────────────────

export type PanelId =
  | "cpu"
  | "memory"
  | "cpu-compact"
  | "memory-compact"
  | "cpu-bar"
  | "memory-pie"
  | "processes";

export interface PanelEntry {
  id: PanelId;
  enabled: boolean;
}

export interface Settings {
  panels: PanelEntry[];
  statusBar: PanelEntry[];
  workspaceStatus: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  panels: [
    { id: "memory", enabled: true },
    { id: "cpu", enabled: true },
    { id: "memory-compact", enabled: false },
    { id: "cpu-compact", enabled: false },
    { id: "processes", enabled: true },
  ],
  statusBar: [
    { id: "cpu", enabled: true },
    { id: "memory", enabled: true },
    { id: "cpu-bar", enabled: false },
    { id: "memory-pie", enabled: false },
  ],
  workspaceStatus: true,
};

// ─── Live data types ───────────────────────────────────────────────────────────

export interface CpuData {
  userPct: number;
  sysPct: number;
  history: CpuSample[];
}

/**
 * One slice of the memory donut. The set of segments is platform-dependent —
 * macOS reports App / Wired / Cache / Free, Linux reports Used / Cache / Free,
 * Windows reports Used / Free — so the UI renders whatever the active collector
 * produces rather than a fixed field list. Segments are ordered and sum to
 * {@link MemData.totalBytes} (the trailing "Free" slice is the remainder).
 */
export interface MemSegment {
  label: string;
  bytes: number;
  /** Data-viz series color (a literal, not a theme token — see MEM_COLORS). */
  color: string;
}

export interface MemData {
  totalBytes: number;
  usedBytes: number;
  segments: MemSegment[];
}

export interface LiveData {
  cpu: CpuData | null;
  memory: MemData | null;
  processes: ProcessesData | null;
  error: string | null;
}

// ─── Settings merge helpers (exported for tests) ───────────────────────────────

export function mergeList(
  saved: PanelEntry[] | undefined,
  defaults: PanelEntry[],
): PanelEntry[] {
  if (!Array.isArray(saved)) return defaults.map((p) => ({ ...p }));
  const knownMap = new Map(defaults.map((p) => [p.id, p]));
  const merged: PanelEntry[] = [];
  for (const sp of saved) {
    if (knownMap.has(sp.id)) {
      merged.push({ id: sp.id, enabled: sp.enabled });
      knownMap.delete(sp.id);
    }
  }
  // Append any new defaults not present in saved (forward-compatibility)
  for (const def of knownMap.values()) merged.push({ ...def });
  return merged;
}

export function mergeSettings(saved: Partial<Settings>): Settings {
  return {
    panels: mergeList(saved.panels, DEFAULT_SETTINGS.panels),
    statusBar: mergeList(saved.statusBar, DEFAULT_SETTINGS.statusBar),
    workspaceStatus: saved.workspaceStatus ?? DEFAULT_SETTINGS.workspaceStatus,
  };
}

// ─── Store ────────────────────────────────────────────────────────────────────

type Listener = () => void;

class SysMonStore {
  private _settings: Settings = mergeSettings({});
  private _live: LiveData = {
    cpu: null,
    memory: null,
    processes: null,
    error: null,
  };
  private _storage: ExtensionStorage | null = null;
  private _listeners = new Set<Listener>();

  get settings(): Settings {
    return this._settings;
  }

  get live(): LiveData {
    return this._live;
  }

  hydrate(storage: ExtensionStorage): void {
    this._storage = storage;
    // Re-read on subscribe too: activate() can run before app state finishes
    // hydrating from disk, so the first read may see nothing. The storage
    // notifies once hydration lands (and on any later external change), at which
    // point we pick up the saved settings.
    const apply = (): void => {
      const next = mergeSettings(storage.get<Settings>("settings") ?? {});
      if (JSON.stringify(next) === JSON.stringify(this._settings)) return;
      this._settings = next;
      this._notify();
    };
    apply();
    storage.subscribe(apply);
  }

  updateSettings(s: Settings): void {
    this._settings = s;
    this._storage?.set("settings", s);
    this._notify();
  }

  updateLive(patch: Partial<LiveData>): void {
    this._live = { ...this._live, ...patch };
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

export const sysmonStore = new SysMonStore();
