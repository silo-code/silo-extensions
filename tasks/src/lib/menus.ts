/**
 * The dropdown contents behind the arrange / lane / label controls, as pure
 * builders over the current {@link ViewPrefs}. Both control chromes render
 * these: the inline `MenuButton`s in the side panel and the Tasks app sheet,
 * and the `"navigator"`-surface toolbar items in the Navigator view's header.
 * One definition, so the three surfaces cannot drift.
 *
 * No React and no `ctx` — a `MenuEntry` is data.
 */

import type { MenuEntry } from "@silo-code/sdk";
import {
  ALL_LANES,
  ALL_PRIORITIES,
  LANE_LABELS,
  PRIORITY_LABELS,
  type TaskLane,
  type TaskPriority,
} from "../model/task";
import type { TaskSource } from "../model/source";
import {
  DEFAULT_LANE_FILTER,
  NO_LIST_LABEL,
  type GroupBy,
  type SortBy,
  type ViewPrefs,
} from "./view";

// Re-exported so existing importers (`Composer.tsx`) don't need to know it
// moved to `view.ts` — see that file for why (avoids a circular import, since
// this module already depends on `view.ts`, not the other way around).
export { NO_LIST_LABEL };

/**
 * `"source"` groups by `TaskSource` — the same concept `TaskDetail`'s identity
 * footer already labels **"List"**. The persisted `GroupBy` value stays the
 * string `"source"` (no prefs migration); only this display label changed.
 */
export const GROUP_LABELS: Record<GroupBy, string> = {
  none: "None",
  source: "List",
  status: "Status",
  label: "Label",
};

export const SORT_LABELS: Record<SortBy, string> = {
  rank: "Creation order",
  updated: "Recently updated",
  priority: "Priority",
  title: "Title",
};

const GROUP_ORDER: readonly GroupBy[] = ["none", "source", "status", "label"];
const SORT_ORDER: readonly SortBy[] = ["rank", "updated", "priority", "title"];

/** Whether the lane filter is exactly the default "every lane but done". */
export function isOpenLaneFilter(laneFilter: readonly TaskLane[]): boolean {
  return (
    laneFilter.length === DEFAULT_LANE_FILTER.length &&
    DEFAULT_LANE_FILTER.every((l) => laneFilter.includes(l))
  );
}

export type ApplyView = (next: Partial<ViewPrefs>) => void;

/** Group-by and sort-by in one menu — both are "how the list is arranged". */
export function arrangeMenu(prefs: ViewPrefs, apply: ApplyView): MenuEntry[] {
  const items: MenuEntry[] = [{ type: "header", label: "Group by" }];
  for (const g of GROUP_ORDER) {
    items.push({
      label: GROUP_LABELS[g],
      checked: prefs.groupBy === g,
      run: () => apply({ groupBy: g }),
    });
  }
  items.push({ type: "header", label: "Sort by" });
  for (const s of SORT_ORDER) {
    items.push({
      label: SORT_LABELS[s],
      checked: prefs.sortBy === s,
      run: () => apply({ sortBy: s }),
    });
  }
  return items;
}

/**
 * The sheet toolbar's Sort dropdown (R15) — replaces the R12 column-header
 * click-to-sort now that the multiline row list has no header row. Same
 * toggle semantics `TasksBody`'s old `onSort` had: picking the already-active
 * field reverses `sortDir`; picking a different one resets to `"asc"`. The
 * active entry's arrow is the only direction indicator — there's no header
 * cell left to carry one.
 */
export function sortMenu(prefs: ViewPrefs, apply: ApplyView): MenuEntry[] {
  return SORT_ORDER.map((s) => {
    const active = prefs.sortBy === s;
    return {
      label: active
        ? `${SORT_LABELS[s]} ${prefs.sortDir === "desc" ? "↓" : "↑"}`
        : SORT_LABELS[s],
      checked: active,
      run: () =>
        apply({
          sortBy: s,
          sortDir: active && prefs.sortDir === "asc" ? "desc" : "asc",
        }),
    };
  });
}

export function lanesMenu(prefs: ViewPrefs, apply: ApplyView): MenuEntry[] {
  const toggle = (lane: TaskLane) => {
    const set = new Set(prefs.laneFilter);
    if (set.has(lane)) set.delete(lane);
    else set.add(lane);
    apply({ laneFilter: ALL_LANES.filter((l) => set.has(l)) });
  };
  const items: MenuEntry[] = [
    {
      label: "Open",
      checked: isOpenLaneFilter(prefs.laneFilter),
      run: () => apply({ laneFilter: DEFAULT_LANE_FILTER }),
    },
    {
      label: "All",
      checked: prefs.laneFilter.length === ALL_LANES.length,
      run: () => apply({ laneFilter: ALL_LANES }),
    },
    { type: "header", label: "Lane" },
  ];
  for (const lane of ALL_LANES) {
    items.push({
      label: LANE_LABELS[lane],
      checked: prefs.laneFilter.includes(lane),
      run: () => toggle(lane),
    });
  }
  return items;
}

export function labelsMenu(
  prefs: ViewPrefs,
  labels: readonly string[],
  apply: ApplyView,
): MenuEntry[] {
  const toggle = (label: string) => {
    const set = new Set(prefs.labelFilter);
    if (set.has(label)) set.delete(label);
    else set.add(label);
    apply({ labelFilter: [...set] });
  };
  return labels.map((label) => ({
    label,
    checked: prefs.labelFilter.includes(label),
    run: () => toggle(label),
  }));
}

/**
 * The sheet's batch bar `Set status` / `Set priority` menus — no "checked"
 * state (a batch selection has no single current lane/priority), each entry
 * just runs the patch.
 */
export function batchLaneMenu(onPick: (lane: TaskLane) => void): MenuEntry[] {
  return ALL_LANES.map((lane) => ({
    label: LANE_LABELS[lane],
    run: () => onPick(lane),
  }));
}

export function batchPriorityMenu(
  onPick: (priority: TaskPriority) => void,
): MenuEntry[] {
  return ALL_PRIORITIES.map((priority) => ({
    label: PRIORITY_LABELS[priority],
    run: () => onPick(priority),
  }));
}

/** The composer's list picker — one entry per resolved source, single-select. */
export function sourcesMenu(
  sources: readonly TaskSource[],
  activeId: string | undefined,
  onPick: (sourceId: string) => void,
): MenuEntry[] {
  return sources.map((s) => ({
    label: s.name || NO_LIST_LABEL,
    checked: s.id === activeId,
    run: () => onPick(s.id),
  }));
}

/**
 * The sheet toolbar's List filter (R12) — single-select and **not
 * checkable**: "All", or exactly one list (the unnamed global one shows as
 * {@link NO_LIST_LABEL}). The active choice is read off the button label
 * ("List: All" / "List: None" / "List: <name>"), not a checkmark. Sits
 * alongside `sortMenu` in the toolbar (R15) — the only way to scope the flat
 * row list down to one list now that grouping is gone (R10).
 */
export function sourceFilterMenu(
  sources: readonly TaskSource[],
  apply: ApplyView,
): MenuEntry[] {
  const items: MenuEntry[] = [
    { label: "All", run: () => apply({ sourceFilter: [] }) },
    { type: "header", label: "List" },
  ];
  for (const s of sources) {
    items.push({
      label: s.name || NO_LIST_LABEL,
      run: () => apply({ sourceFilter: [s.id] }),
    });
  }
  return items;
}

/**
 * The Navigator view's List filter — **multi-select** and checkable, unlike
 * the sheet's single-select {@link sourceFilterMenu}. "All lists" clears the
 * filter; each list toggles in/out. The stored `sourceFilter` is kept in
 * `sources` order so a round-trip is stable. `filterTasks` treats it as a set,
 * so `[]` (the "All lists" state) shows every list.
 */
export function sourcesFilterMenu(
  sources: readonly TaskSource[],
  prefs: ViewPrefs,
  apply: ApplyView,
): MenuEntry[] {
  const set = new Set(prefs.sourceFilter);
  const toggle = (id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    apply({
      sourceFilter: sources.filter((s) => next.has(s.id)).map((s) => s.id),
    });
  };
  const items: MenuEntry[] = [
    {
      label: "All lists",
      checked: set.size === 0,
      run: () => apply({ sourceFilter: [] }),
    },
    { type: "header", label: "List" },
  ];
  for (const s of sources) {
    items.push({
      label: s.name || NO_LIST_LABEL,
      checked: set.has(s.id),
      run: () => toggle(s.id),
    });
  }
  return items;
}

/**
 * The Navigator view's single "View options" toolbar dropdown — the whole
 * arrange / filter surface folded into one button with cascading submenus
 * (Group by, Sort by, Filter by status / label, List). Replaced the three
 * separate `silo.tasks.nav.arrange|lanes|labels` toolbar items. Rebuilt on
 * every open, so `labels` / `sources` are always current — the label submenu
 * is simply omitted when nothing carries a label.
 */
export function viewMenu(
  prefs: ViewPrefs,
  labels: readonly string[],
  sources: readonly TaskSource[],
  apply: ApplyView,
): MenuEntry[] {
  const items: MenuEntry[] = [
    {
      label: "Group by",
      submenu: GROUP_ORDER.map((g) => ({
        label: GROUP_LABELS[g],
        checked: prefs.groupBy === g,
        run: () => apply({ groupBy: g }),
      })),
    },
    { label: "Sort by", submenu: sortMenu(prefs, apply) },
    { type: "separator" },
    { label: "Filter by status", submenu: lanesMenu(prefs, apply) },
  ];
  if (labels.length > 0) {
    items.push({
      label: "Filter by label",
      submenu: labelsMenu(prefs, labels, apply),
    });
  }
  items.push({ label: "List", submenu: sourcesFilterMenu(sources, prefs, apply) });
  return items;
}
