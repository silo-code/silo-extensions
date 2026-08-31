/**
 * Panel view preferences — persisted in **`ctx.storage.global`**, keyed by
 * workspace id (with a `"global"` key for the no-workspace case).
 *
 * Not `SidePanelProps.storage` / `ctx.storage.workspace`: those are the same
 * per-workspace bag, captured into the *workspace record*, so with no workspace
 * open (a case R2 requires to work) every write is discarded on the next
 * switch. A global-scope bag keyed by workspace id keeps per-workspace variance
 * *and* can express the no-workspace case.
 *
 * There is no "new tasks go to" preference: the side panel always creates in
 * the active workspace's source (falling back to the global list when no
 * workspace is open — see `source-set.resolveDestination`).
 */

import type { ExtensionStorage, ReactiveService } from "@silo-code/sdk";
import {
  DEFAULT_VIEW_PREFS,
  type GroupBy,
  type SortBy,
  type ViewPrefs,
} from "./view";
import { ALL_LANES, type TaskLane } from "../model/task";

export interface TaskPrefs {
  readonly workspaceId: string | null;
  readonly view: ViewPrefs;
}

const GROUP_BY: readonly GroupBy[] = ["none", "status", "source", "label"];
const SORT_BY: readonly SortBy[] = ["rank", "updated", "priority", "title"];
const LANE_SET = new Set<string>(ALL_LANES);

function viewKey(workspaceId: string | null): string {
  return workspaceId ? `view:${workspaceId}` : "view:global";
}

function coerceView(raw: unknown): ViewPrefs {
  if (typeof raw !== "object" || raw === null) return DEFAULT_VIEW_PREFS;
  const o = raw as Record<string, unknown>;
  const groupBy = GROUP_BY.includes(o.groupBy as GroupBy)
    ? (o.groupBy as GroupBy)
    : DEFAULT_VIEW_PREFS.groupBy;
  const sortBy = SORT_BY.includes(o.sortBy as SortBy)
    ? (o.sortBy as SortBy)
    : DEFAULT_VIEW_PREFS.sortBy;
  const labelFilter = Array.isArray(o.labelFilter)
    ? (o.labelFilter.filter((l) => typeof l === "string") as string[])
    : [];
  const query = typeof o.query === "string" ? o.query : "";
  const collapsedGroups: Record<string, boolean> = {};
  if (o.collapsedGroups && typeof o.collapsedGroups === "object") {
    for (const [k, v] of Object.entries(
      o.collapsedGroups as Record<string, unknown>,
    )) {
      if (v === true) collapsedGroups[k] = true;
    }
  }
  return {
    groupBy,
    sortBy,
    // An empty stored laneFilter is legitimate (user unchecked every lane);
    // only a missing / non-array value falls back to the default.
    laneFilter: Array.isArray(o.laneFilter)
      ? (o.laneFilter.filter((l) => LANE_SET.has(l as string)) as TaskLane[])
      : [...DEFAULT_VIEW_PREFS.laneFilter],
    labelFilter,
    query,
    collapsedGroups,
  };
}

function sameArray(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function sameCollapsed(
  a: Readonly<Record<string, boolean>>,
  b: Readonly<Record<string, boolean>>,
): boolean {
  const ak = Object.keys(a).filter((k) => a[k]);
  const bk = Object.keys(b).filter((k) => b[k]);
  return ak.length === bk.length && ak.every((k) => b[k] === true);
}

/** Field-by-field equality — order-independent, unlike a JSON.stringify compare. */
export function sameView(a: ViewPrefs, b: ViewPrefs): boolean {
  return (
    a.groupBy === b.groupBy &&
    a.sortBy === b.sortBy &&
    a.query === b.query &&
    sameArray(a.laneFilter, b.laneFilter) &&
    sameArray(a.labelFilter, b.labelFilter) &&
    sameCollapsed(a.collapsedGroups, b.collapsedGroups)
  );
}

/** Read the persisted prefs for one workspace key. Pure over the storage bag. */
export function readTaskPrefs(
  storage: ExtensionStorage,
  workspaceId: string | null,
): TaskPrefs {
  return { workspaceId, view: coerceView(storage.get(viewKey(workspaceId))) };
}

export function writeViewPrefs(
  storage: ExtensionStorage,
  workspaceId: string | null,
  view: ViewPrefs,
): void {
  storage.set(viewKey(workspaceId), view);
}

export interface PrefsStore extends ReactiveService<TaskPrefs> {
  setWorkspace(workspaceId: string | null): void;
  /** Call when `SidePanelProps.hydrated` flips — re-reads from storage. */
  setHydrated(hydrated: boolean): void;
  setView(view: ViewPrefs): void;
  /** Detach the underlying `storage.subscribe`. Push onto `ctx.subscriptions`. */
  dispose(): void;
}

/**
 * A small reactive store over the persisted prefs — mirrors agent-monitor's
 * `settingsService`. `getState()` returns a stable object whose identity
 * changes only on real change, so `useServiceState` won't loop.
 */
export function createPrefsStore(storage: ExtensionStorage): PrefsStore {
  let workspaceId: string | null = null;
  let hydrated = false;
  let state: TaskPrefs = readTaskPrefs(storage, workspaceId);
  const listeners = new Set<(s: TaskPrefs) => void>();

  function emit() {
    for (const l of listeners) l(state);
  }

  function refresh() {
    const next = readTaskPrefs(storage, workspaceId);
    if (
      next.workspaceId !== state.workspaceId ||
      !sameView(next.view, state.view)
    ) {
      state = next;
      emit();
    }
  }

  const sub = storage.subscribe(refresh);

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    dispose: () => sub.dispose(),
    setWorkspace(next) {
      if (next === workspaceId) return;
      workspaceId = next;
      refresh();
    },
    setHydrated(next) {
      if (next === hydrated) return;
      hydrated = next;
      refresh();
    },
    setView(view) {
      if (!hydrated) return; // don't clobber a not-yet-restored value
      // Update in-memory state first so the storage-subscribe `refresh` below
      // sees no diff and doesn't double-emit; then persist.
      state = { ...state, view };
      emit();
      writeViewPrefs(storage, workspaceId, view);
    },
  };
}
