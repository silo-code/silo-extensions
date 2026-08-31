/**
 * Groups + rows over {@link buildView}. Group headers follow the shared
 * side-panel section-header pattern (`docs/side-panel-design.md`) — the same
 * one skills-manager and git-explorer use: uppercase chrome label, a
 * collapse chevron, and a right-aligned `Badge` count. When there's nothing to
 * show it renders a plain muted line (github-prs `.ghpr-empty` style).
 */

import { CaretDown, CaretRight } from "@phosphor-icons/react";
import { Badge } from "@silo-code/sdk";
import type { Task } from "../model/task";
import type { TaskGroup } from "../lib/view";
import { TaskRow } from "./TaskRow";

export function TaskList({
  groups,
  totalVisible,
  hasAnyTask,
  filtered,
  collapsedGroups,
  openTaskId,
  onOpen,
  onToggleGroup,
  onClearFilters,
}: {
  groups: readonly TaskGroup[];
  /** Rows across every group after filtering. */
  totalVisible: number;
  /** Whether any task exists at all, before filtering. */
  hasAnyTask: boolean;
  /** Whether a non-empty filter / query is currently narrowing the list. */
  filtered: boolean;
  collapsedGroups: Readonly<Record<string, boolean>>;
  openTaskId: string | null;
  onOpen: (task: Task) => void;
  onToggleGroup: (key: string) => void;
  onClearFilters: () => void;
}) {
  if (totalVisible === 0) {
    if (hasAnyTask && filtered) {
      return (
        <div className="tasks-empty">
          No tasks match.{" "}
          <button
            type="button"
            className="tasks-empty-link"
            onClick={onClearFilters}
          >
            Clear filters
          </button>
        </div>
      );
    }
    return <div className="tasks-empty">No tasks yet — add one below.</div>;
  }

  return (
    <div className="tasks-list">
      {groups.map((group) => {
        // The single unnamed group never gets a header, so it can't collapse.
        const collapsible = group.title !== "";
        const open = !collapsible || !collapsedGroups[group.key];
        return (
          <div className="tasks-group" key={group.key}>
            {collapsible && (
              <div
                className="tasks-section-head"
                role="button"
                tabIndex={0}
                aria-expanded={open}
                onClick={() => onToggleGroup(group.key)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onToggleGroup(group.key);
                  }
                }}
              >
                <span className="tasks-section-chev" aria-hidden="true">
                  {open ? (
                    <CaretDown size="0.85em" weight="bold" />
                  ) : (
                    <CaretRight size="0.85em" weight="bold" />
                  )}
                </span>
                <span className="tasks-section-title">{group.title}</span>
                <span className="tasks-section-count">
                  <Badge size="sm">{group.tasks.length}</Badge>
                </span>
              </div>
            )}
            {open &&
              group.tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  selected={task.id === openTaskId}
                  onOpen={() => onOpen(task)}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}
