/**
 * The panel toolbar: three dropdown controls (arrange, lanes, labels) above an
 * inline `SearchInput`, per `docs/side-panel-design.md`. Each dropdown's label
 * is its current value — no "Group:" / "Filter:" prefix — with a `Tooltip`
 * naming it. Grouping and sorting share one menu (both are "how the list is
 * arranged"); lane and label filters get one menu each. The Labels dropdown is
 * only shown once at least one label exists.
 */

import { ArrowsClockwise } from "@phosphor-icons/react";
import { MenuButton, SearchInput, Tooltip, type MenuEntry } from "@silo-code/sdk";
import { ALL_LANES, LANE_LABELS, type TaskLane } from "../model/task";
import {
  DEFAULT_LANE_FILTER,
  laneFilterLabel,
  labelFilterLabel,
  type GroupBy,
  type SortBy,
  type ViewPrefs,
} from "../lib/view";

const GROUP_LABELS: Record<GroupBy, string> = {
  none: "None",
  source: "Source",
  status: "Status",
  label: "Label",
};

const SORT_LABELS: Record<SortBy, string> = {
  rank: "Creation order",
  updated: "Recently updated",
  priority: "Priority",
  title: "Title",
};

export interface ToolbarHandlers {
  showMenu: (items: MenuEntry[], anchor: HTMLElement) => void;
  onView: (next: Partial<ViewPrefs>) => void;
  onRefresh: () => void;
}

export function TasksToolbar({
  prefs,
  labels,
  handlers,
}: {
  prefs: ViewPrefs;
  labels: readonly string[];
  handlers: ToolbarHandlers;
}) {
  function openArrangeMenu(anchor: HTMLElement) {
    const items: MenuEntry[] = [{ type: "header", label: "Group by" }];
    for (const g of ["none", "source", "status", "label"] as GroupBy[]) {
      items.push({
        label: GROUP_LABELS[g],
        checked: prefs.groupBy === g,
        run: () => handlers.onView({ groupBy: g }),
      });
    }
    items.push({ type: "header", label: "Sort by" });
    for (const s of ["rank", "updated", "priority", "title"] as SortBy[]) {
      items.push({
        label: SORT_LABELS[s],
        checked: prefs.sortBy === s,
        run: () => handlers.onView({ sortBy: s }),
      });
    }
    handlers.showMenu(items, anchor);
  }

  function toggleLane(lane: TaskLane) {
    const set = new Set(prefs.laneFilter);
    if (set.has(lane)) set.delete(lane);
    else set.add(lane);
    handlers.onView({ laneFilter: ALL_LANES.filter((l) => set.has(l)) });
  }

  function toggleLabel(label: string) {
    const set = new Set(prefs.labelFilter);
    if (set.has(label)) set.delete(label);
    else set.add(label);
    handlers.onView({ labelFilter: [...set] });
  }

  function openLanesMenu(anchor: HTMLElement) {
    const isOpen =
      prefs.laneFilter.length === DEFAULT_LANE_FILTER.length &&
      DEFAULT_LANE_FILTER.every((l) => prefs.laneFilter.includes(l));
    const items: MenuEntry[] = [
      {
        label: "Open",
        checked: isOpen,
        run: () => handlers.onView({ laneFilter: DEFAULT_LANE_FILTER }),
      },
      {
        label: "All",
        checked: prefs.laneFilter.length === ALL_LANES.length,
        run: () => handlers.onView({ laneFilter: ALL_LANES }),
      },
      { type: "header", label: "Lane" },
    ];
    for (const lane of ALL_LANES) {
      items.push({
        label: LANE_LABELS[lane],
        checked: prefs.laneFilter.includes(lane),
        run: () => toggleLane(lane),
      });
    }
    handlers.showMenu(items, anchor);
  }

  function openLabelsMenu(anchor: HTMLElement) {
    const items: MenuEntry[] = labels.map((label) => ({
      label,
      checked: prefs.labelFilter.includes(label),
      run: () => toggleLabel(label),
    }));
    handlers.showMenu(items, anchor);
  }

  return (
    <div className="tasks-toolbar">
      <div className="tasks-toolbar-actions">
        <Tooltip content="Arrange">
          <MenuButton
            size="sm"
            className="tasks-menu-btn"
            label={GROUP_LABELS[prefs.groupBy]}
            onClick={(e) => openArrangeMenu(e.currentTarget)}
          />
        </Tooltip>
        <Tooltip content="Filter by lane">
          <MenuButton
            size="sm"
            className="tasks-menu-btn"
            label={laneFilterLabel(prefs.laneFilter)}
            onClick={(e) => openLanesMenu(e.currentTarget)}
          />
        </Tooltip>
        {labels.length > 0 && (
          <Tooltip content="Filter by label">
            <MenuButton
              size="sm"
              className="tasks-menu-btn"
              label={labelFilterLabel(prefs.labelFilter)}
              onClick={(e) => openLabelsMenu(e.currentTarget)}
            />
          </Tooltip>
        )}
        <span className="tasks-toolbar-spacer" />
        <Tooltip content="Refresh">
          <button
            type="button"
            className="tasks-icon-hit"
            aria-label="Refresh"
            onClick={handlers.onRefresh}
          >
            <ArrowsClockwise size={14} />
          </button>
        </Tooltip>
      </div>
      <SearchInput
        value={prefs.query}
        onValueChange={(query) => handlers.onView({ query })}
        placeholder="Filter tasks…"
      />
    </div>
  );
}
