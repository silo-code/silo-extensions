/**
 * The inline toolbar: dropdown controls above an inline `SearchInput`, per
 * `docs/side-panel-design.md`. In the side panel (`variant="list"`) each
 * dropdown's label is its bare current value — no "Group:" / "Filter:" prefix
 * — with a `Tooltip` naming it. The wider sheet (`variant="rows"`) prefixes
 * each label instead ("List: …", "Sort: …", "Status: …", "Labels: …") — it
 * has the room, and the four dropdowns sit close together there. The Labels
 * dropdown is only shown once at least one label exists.
 *
 * The Navigator view passes `controls={false}`: there the same dropdowns are
 * `"navigator"`-surface toolbar items in the host's header, so only the
 * search box would belong in the body — and even that is hidden by
 * `search={false}` (R13): the Navigator's own toolbar gained a button that
 * opens the sheet instead, which has the room for a real search box.
 */

import { ArrowsClockwise } from "@phosphor-icons/react";
import { MenuButton, SearchInput, Tooltip, type MenuEntry } from "@silo-code/sdk";
import {
  arrangeMenu,
  GROUP_LABELS,
  labelsMenu,
  lanesMenu,
  sortMenu,
  SORT_LABELS,
  sourceFilterMenu,
} from "../lib/menus";
import {
  laneFilterLabel,
  labelFilterLabel,
  sourceFilterLabel,
  type ViewPrefs,
} from "../lib/view";
import type { TaskSource } from "../model/source";

export interface ToolbarHandlers {
  showMenu: (items: MenuEntry[], anchor: HTMLElement) => void;
  onView: (next: Partial<ViewPrefs>) => void;
  onRefresh: () => void;
}

export function TasksToolbar({
  prefs,
  labels,
  sources,
  handlers,
  controls = true,
  search = true,
  variant = "list",
}: {
  prefs: ViewPrefs;
  labels: readonly string[];
  /** Only read when `variant === "rows"`, to build the List filter menu. */
  sources: readonly TaskSource[];
  handlers: ToolbarHandlers;
  controls?: boolean;
  /** `false` hides the inline `SearchInput` entirely (R13, the Navigator view). */
  search?: boolean;
  /**
   * `"rows"` swaps the combined "Arrange" (group + sort) control for two —
   * "List" filter and "Sort" — one the sheet (R12/R15). Grouping is already
   * dropped there (R10); sorting has no header row to click any more (R15
   * dropped the `<table>`), so it moves to its own dropdown alongside the
   * list filter the flat row list has no other way to reach.
   */
  variant?: "list" | "rows";
}) {
  const rows = variant === "rows";
  // The sheet prefixes each dropdown label ("Status: Open"); the side panel
  // shows the bare value, per `docs/side-panel-design.md`.
  const btn = (prefix: string, value: string) =>
    rows ? `${prefix}: ${value}` : value;
  return (
    <div className="tasks-toolbar">
      {controls && (
        <div className="tasks-toolbar-actions">
          {rows ? (
            <>
              <Tooltip content="Filter by list">
                <MenuButton
                  size="sm"
                  className="tasks-menu-btn"
                  label={btn(
                    "List",
                    sourceFilterLabel(prefs.sourceFilter, sources),
                  )}
                  onClick={(e) =>
                    handlers.showMenu(
                      sourceFilterMenu(sources, handlers.onView),
                      e.currentTarget,
                    )
                  }
                />
              </Tooltip>
              <Tooltip content="Sort">
                <MenuButton
                  size="sm"
                  className="tasks-menu-btn"
                  label={btn("Sort", SORT_LABELS[prefs.sortBy])}
                  onClick={(e) =>
                    handlers.showMenu(
                      sortMenu(prefs, handlers.onView),
                      e.currentTarget,
                    )
                  }
                />
              </Tooltip>
            </>
          ) : (
            <Tooltip content="Arrange">
              <MenuButton
                size="sm"
                className="tasks-menu-btn"
                label={GROUP_LABELS[prefs.groupBy]}
                onClick={(e) =>
                  handlers.showMenu(
                    arrangeMenu(prefs, handlers.onView),
                    e.currentTarget,
                  )
                }
              />
            </Tooltip>
          )}
          <Tooltip content="Filter by status">
            <MenuButton
              size="sm"
              className="tasks-menu-btn"
              label={btn("Status", laneFilterLabel(prefs.laneFilter))}
              onClick={(e) =>
                handlers.showMenu(
                  lanesMenu(prefs, handlers.onView),
                  e.currentTarget,
                )
              }
            />
          </Tooltip>
          {labels.length > 0 && (
            <Tooltip content="Filter by label">
              <MenuButton
                size="sm"
                className="tasks-menu-btn"
                label={btn(
                  "Labels",
                  labelFilterLabel(prefs.labelFilter, rows ? "None" : undefined),
                )}
                onClick={(e) =>
                  handlers.showMenu(
                    labelsMenu(prefs, labels, handlers.onView),
                    e.currentTarget,
                  )
                }
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
      )}
      {search && (
        <SearchInput
          value={prefs.query}
          onValueChange={(query) => handlers.onView({ query })}
          placeholder="Filter tasks…"
        />
      )}
    </div>
  );
}
