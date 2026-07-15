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
  /**
   * CPU/memory levels that turn a session's status row and a workspace's
   * badge warn (yellow) or danger (red). CPU is per-core (see
   * {@link ProcessStats.cpuPercent} in the SDK) and, for the workspace badge,
   * summed across every session and descendant process in that workspace —
   * so a handful of concurrently busy terminals routinely clears 100%.
   * Memory is summed the same way, in MB.
   */
  cpuWarnPercent: number;
  cpuDangerPercent: number;
  memWarnMb: number;
  memDangerMb: number;
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
  // Higher than the original 25/75/500/2000 — those were tuned as if a
  // session's own CPU% were the only input, but the workspace badge sums CPU
  // and memory across every session (and its descendants) in the workspace,
  // so a few ordinarily-busy terminals (an agent, a dev server, a watcher)
  // cleared the old "danger" level constantly. These aim for "this workspace
  // is doing something notable" (warn) and "this workspace is under serious,
  // sustained load" (danger).
  cpuWarnPercent: 50,
  cpuDangerPercent: 150,
  memWarnMb: 1024,
  memDangerMb: 4096,
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

/** One open workspace's process data, for the all-workspaces modal. */
export interface WorkspaceProcessesData {
  workspaceId: string;
  name: string;
  active: boolean;
  data: ProcessesData;
}

export interface LiveData {
  cpu: CpuData | null;
  memory: MemData | null;
  /** Rolling used-memory percentages (0–100), same cadence/window as the CPU
   * history — memory collectors only report a snapshot, so the poll keeps
   * this buffer for the modal's mini history graph. */
  memHistory: number[] | null;
  processes: ProcessesData | null;
  /** Every open workspace's rows/aggregate — null until the first stats tick. */
  allProcesses: WorkspaceProcessesData[] | null;
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

/** Falls back to `fallback` unless `saved` is a positive, finite number —
 * guards against corrupted storage rather than propagating a NaN/0/negative
 * threshold that would never (or always) trigger. */
export function mergeThreshold(saved: unknown, fallback: number): number {
  return typeof saved === "number" && Number.isFinite(saved) && saved > 0
    ? saved
    : fallback;
}

export function mergeSettings(saved: Partial<Settings>): Settings {
  return {
    panels: mergeList(saved.panels, DEFAULT_SETTINGS.panels),
    statusBar: mergeList(saved.statusBar, DEFAULT_SETTINGS.statusBar),
    workspaceStatus: saved.workspaceStatus ?? DEFAULT_SETTINGS.workspaceStatus,
    cpuWarnPercent: mergeThreshold(
      saved.cpuWarnPercent,
      DEFAULT_SETTINGS.cpuWarnPercent,
    ),
    cpuDangerPercent: mergeThreshold(
      saved.cpuDangerPercent,
      DEFAULT_SETTINGS.cpuDangerPercent,
    ),
    memWarnMb: mergeThreshold(saved.memWarnMb, DEFAULT_SETTINGS.memWarnMb),
    memDangerMb: mergeThreshold(saved.memDangerMb, DEFAULT_SETTINGS.memDangerMb),
  };
}

// ─── Store ────────────────────────────────────────────────────────────────────

type Listener = () => void;

class SysMonStore {
  private _settings: Settings = mergeSettings({});
  private _live: LiveData = {
    cpu: null,
    memory: null,
    memHistory: null,
    processes: null,
    allProcesses: null,
    error: null,
  };
  private _storage: ExtensionStorage | null = null;
  private _listeners = new Set<Listener>();
  private _modalActive = false;

  get settings(): Settings {
    return this._settings;
  }

  get live(): LiveData {
    return this._live;
  }

  /** True while the all-processes modal is showing. Both the metric poll
   * (CPU/memory for the mini graphs) and the processes controller (stats +
   * trees) treat an open modal as a consumer that needs live data. */
  get modalActive(): boolean {
    return this._modalActive;
  }

  setModalActive(active: boolean): void {
    if (active === this._modalActive) return;
    this._modalActive = active;
    this._notify();
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
