/**
 * The Navigator view's own state — how it groups, and which groups are
 * collapsed. One key, `"view"`, in **`ctx.storage.global`**.
 *
 * Deliberately not `ctx.storage.workspace`: that bag is captured into the
 * *active workspace's* record, and this surface is cross-workspace and has to
 * work with no workspace open at all — every write to the per-workspace bag
 * would be discarded on the next switch.
 *
 * Pure — `import type` only, so the unit tests never load the SDK runtime.
 */

import type { Disposable, ExtensionStorage, ReactiveService } from "@silo-code/sdk";
import { GROUP_BY_VALUES, type FollowUpGroupBy } from "./view";

export const STORAGE_KEY_VIEW = "view";

export const DEFAULT_GROUP_BY: FollowUpGroupBy = "workspace";

export interface ViewPrefs {
  groupBy: FollowUpGroupBy;
  collapsedGroups: Readonly<Record<string, boolean>>;
}

export const DEFAULT_VIEW_PREFS: ViewPrefs = {
  groupBy: DEFAULT_GROUP_BY,
  collapsedGroups: {},
};

export interface ViewPrefsStore extends ReactiveService<ViewPrefs> {
  setGroupBy(groupBy: FollowUpGroupBy): void;
  toggleGroup(key: string): void;
  /**
   * Flip once storage has hydrated. Until then writes are dropped — a write
   * before hydration would clobber the value saved last session.
   * `NavigatorViewProps` carries no `hydrated` flag, so the caller gates on
   * the first `storage.subscribe` fire.
   */
  setHydrated(hydrated: boolean): void;
  dispose(): void;
}

export function coerceViewPrefs(raw: unknown): ViewPrefs {
  if (!raw || typeof raw !== "object") return DEFAULT_VIEW_PREFS;
  const o = raw as Record<string, unknown>;
  const groupBy = GROUP_BY_VALUES.includes(o.groupBy as FollowUpGroupBy)
    ? (o.groupBy as FollowUpGroupBy)
    : DEFAULT_GROUP_BY;
  const collapsedGroups: Record<string, boolean> = {};
  if (o.collapsedGroups && typeof o.collapsedGroups === "object") {
    for (const [k, v] of Object.entries(
      o.collapsedGroups as Record<string, unknown>,
    )) {
      // Only `true` is stored — an explicit `false` is the same as absent, and
      // dropping it keeps the persisted bag from growing a key per group the
      // user ever expanded.
      if (v === true) collapsedGroups[k] = true;
    }
  }
  return { groupBy, collapsedGroups };
}

function sameCollapsed(
  a: Readonly<Record<string, boolean>>,
  b: Readonly<Record<string, boolean>>,
): boolean {
  const ak = Object.keys(a).filter((k) => a[k]);
  const bk = Object.keys(b).filter((k) => b[k]);
  return ak.length === bk.length && ak.every((k) => b[k] === true);
}

export function samePrefs(a: ViewPrefs, b: ViewPrefs): boolean {
  return (
    a.groupBy === b.groupBy &&
    sameCollapsed(a.collapsedGroups, b.collapsedGroups)
  );
}

export function createViewPrefsStore(
  storage: ExtensionStorage,
): ViewPrefsStore {
  let hydrated = false;
  let state: ViewPrefs = coerceViewPrefs(storage.get(STORAGE_KEY_VIEW));
  const listeners = new Set<(s: ViewPrefs) => void>();

  function emit() {
    for (const l of listeners) l(state);
  }

  function refresh() {
    const next = coerceViewPrefs(storage.get(STORAGE_KEY_VIEW));
    if (samePrefs(next, state)) return;
    state = next;
    emit();
  }

  function write(next: ViewPrefs) {
    if (!hydrated) return;
    // In-memory first so the `storage.subscribe` refresh sees no diff and
    // doesn't emit a second time; then persist.
    state = next;
    emit();
    storage.set(STORAGE_KEY_VIEW, next);
  }

  const sub: Disposable = storage.subscribe(refresh);

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    dispose: () => sub.dispose(),
    setHydrated(next) {
      if (next === hydrated) return;
      hydrated = next;
      refresh();
    },
    setGroupBy(groupBy) {
      if (groupBy === state.groupBy) return;
      write({ ...state, groupBy });
    },
    toggleGroup(key) {
      const collapsedGroups = { ...state.collapsedGroups };
      if (collapsedGroups[key]) delete collapsedGroups[key];
      else collapsedGroups[key] = true;
      write({ ...state, collapsedGroups });
    },
  };
}
