/**
 * View preferences — persisted in **`ctx.storage.global`**, keyed by workspace
 * id (with a `"global"` key for the no-workspace case, a `"cross"` key for the
 * Navigator cross-workspace view, and a `"sheet"` key for the Tasks app sheet).
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
  type SortDir,
  type ViewPrefs,
} from "./view";
import { ALL_LANES, type TaskLane } from "../model/task";

/**
 * Which list a set of prefs belongs to: a workspace id, `null` for the
 * no-workspace case, {@link CROSS_SCOPE} for the Navigator cross-workspace
 * view, or {@link SHEET_SCOPE} for the Tasks app sheet. The Navigator view
 * and the sheet aggregate the same sources but keep their arrange/filter/sort
 * state apart — the narrow rail and the full-width sheet are arranged
 * differently.
 */
export type PrefsScope = string | null;

/**
 * The Navigator cross-workspace view's scope. Not a workspace id — workspace
 * ids are generated, so this literal cannot collide with one.
 */
export const CROSS_SCOPE = "cross";

/** The Tasks app sheet's scope. Kept apart from {@link CROSS_SCOPE}. */
export const SHEET_SCOPE = "sheet";

const FIXED_SCOPES = new Set<PrefsScope>([CROSS_SCOPE, SHEET_SCOPE]);

export interface TaskPrefs {
  readonly scope: PrefsScope;
  readonly view: ViewPrefs;
}

const GROUP_BY: readonly GroupBy[] = ["none", "status", "source", "label"];
const SORT_BY: readonly SortBy[] = ["rank", "updated", "priority", "title"];
const LANE_SET = new Set<string>(ALL_LANES);

function viewKey(scope: PrefsScope): string {
  return scope ? `view:${scope}` : "view:global";
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
  const sortDir: SortDir = o.sortDir === "desc" ? "desc" : "asc";
  const labelFilter = Array.isArray(o.labelFilter)
    ? (o.labelFilter.filter((l) => typeof l === "string") as string[])
    : [];
  // Empty is legitimate here too (every source shown) — same "missing/
  // non-array only" fallback rule as labelFilter, not laneFilter's "always a
  // concrete set".
  const sourceFilter = Array.isArray(o.sourceFilter)
    ? (o.sourceFilter.filter((s) => typeof s === "string") as string[])
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
    sortDir,
    // An empty stored laneFilter is legitimate (user unchecked every lane);
    // only a missing / non-array value falls back to the default.
    laneFilter: Array.isArray(o.laneFilter)
      ? (o.laneFilter.filter((l) => LANE_SET.has(l as string)) as TaskLane[])
      : [...DEFAULT_VIEW_PREFS.laneFilter],
    labelFilter,
    sourceFilter,
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
    a.sortDir === b.sortDir &&
    a.query === b.query &&
    sameArray(a.laneFilter, b.laneFilter) &&
    sameArray(a.labelFilter, b.labelFilter) &&
    sameArray(a.sourceFilter, b.sourceFilter) &&
    sameCollapsed(a.collapsedGroups, b.collapsedGroups)
  );
}

/** Read the persisted prefs for one scope key. Pure over the storage bag. */
export function readTaskPrefs(
  storage: ExtensionStorage,
  scope: PrefsScope,
): TaskPrefs {
  return { scope, view: coerceView(storage.get(viewKey(scope))) };
}

export function writeViewPrefs(
  storage: ExtensionStorage,
  scope: PrefsScope,
  view: ViewPrefs,
): void {
  storage.set(viewKey(scope), view);
}

export interface PrefsStore extends ReactiveService<TaskPrefs> {
  /**
   * Point the store at a workspace's key. A no-op on a store created for
   * {@link CROSS_SCOPE} or {@link SHEET_SCOPE} — the aggregated surfaces are
   * not per-workspace.
   */
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
export function createPrefsStore(
  storage: ExtensionStorage,
  initialScope: PrefsScope = null,
): PrefsStore {
  const fixed = FIXED_SCOPES.has(initialScope);
  let scope: PrefsScope = initialScope;
  let hydrated = false;
  let state: TaskPrefs = readTaskPrefs(storage, scope);
  const listeners = new Set<(s: TaskPrefs) => void>();

  function emit() {
    for (const l of listeners) l(state);
  }

  function refresh() {
    const next = readTaskPrefs(storage, scope);
    if (next.scope !== state.scope || !sameView(next.view, state.view)) {
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
      if (fixed || next === scope) return;
      scope = next;
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
      writeViewPrefs(storage, scope, view);
    },
  };
}
