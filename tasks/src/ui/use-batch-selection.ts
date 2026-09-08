/**
 * The sheet's batch-selection state — a set of picked task ids. Exists only
 * for `TaskRows`; the panel and the Navigator view never call this.
 *
 * The reducer is exported separately so the rules are unit-testable without
 * rendering anything, matching `use-drill-in.ts`.
 */

import { useCallback, useMemo, useState } from "react";

export type PickedIds = ReadonlySet<string>;

export type PickedAction =
  | { type: "toggle"; id: string }
  | { type: "toggleAll"; ids: readonly string[] }
  | { type: "clear" };

/**
 * `"toggleAll"` picks every id in `ids` when any of them is currently unpicked,
 * and clears all of them only when every one is already picked — the standard
 * "select all visible" checkbox behavior, not a blind toggle that could
 * un-pick rows outside the current filter.
 */
export function pickedReducer(
  state: PickedIds,
  action: PickedAction,
): PickedIds {
  switch (action.type) {
    case "toggle": {
      const next = new Set(state);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return next;
    }
    case "toggleAll": {
      const allPicked =
        action.ids.length > 0 && action.ids.every((id) => state.has(id));
      const next = new Set(state);
      for (const id of action.ids) {
        if (allPicked) next.delete(id);
        else next.add(id);
      }
      return next;
    }
    case "clear":
      return state.size === 0 ? state : new Set();
  }
}

export interface BatchSelection {
  picked: PickedIds;
  toggle(id: string): void;
  toggleAll(ids: readonly string[]): void;
  clear(): void;
}

export function useBatchSelection(): BatchSelection {
  const [picked, setPicked] = useState<PickedIds>(() => new Set());

  const dispatch = useCallback(
    (action: PickedAction) => setPicked((s) => pickedReducer(s, action)),
    [],
  );
  const toggle = useCallback(
    (id: string) => dispatch({ type: "toggle", id }),
    [dispatch],
  );
  const toggleAll = useCallback(
    (ids: readonly string[]) => dispatch({ type: "toggleAll", ids }),
    [dispatch],
  );
  const clear = useCallback(() => dispatch({ type: "clear" }), [dispatch]);

  return useMemo(
    () => ({ picked, toggle, toggleAll, clear }),
    [picked, toggle, toggleAll, clear],
  );
}
