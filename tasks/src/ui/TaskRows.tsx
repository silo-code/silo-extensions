/**
 * The sheet's `variant="rows"` list page (R15) — one multiline row per task,
 * replacing the R9–R14 `<table>` (TanStack, resizable/sortable columns). The
 * sheet aggregates too much per task (description, labels, list, id, updated
 * time) for a fixed-width table to show without truncating something; a
 * taller row can show all of it instead. `TaskList` / `TaskRow` above are
 * untouched — the panel and the Navigator view still render those (R5).
 *
 * Grouping stays forced to `"none"` for this variant (R10), so `groups` is
 * always one flat, unlabeled group in practice — this flattens it rather
 * than render a header for it. Sorting is fully toolbar-driven now
 * (`lib/menus.ts`'s `sortMenu`, R15) — there's no header row left to click,
 * so this component takes no `sortBy` / `sortDir` / `onSort` at all; it just
 * renders `groups` in whatever order `buildView` already produced.
 */

import { useMemo, Fragment, type ReactNode } from "react";
import { Check } from "@phosphor-icons/react";
import { Tooltip } from "@silo-code/sdk";
import type { Task } from "../model/task";
import type { TaskGroup } from "../lib/view";
import type { TaskSource } from "../model/source";
import type { PickedIds } from "./use-batch-selection";
import { formatRelativeTime } from "../lib/time";
import { labelChipStyle } from "../lib/labels";
import { PriorityMark, StatusGlyph } from "./glyphs";

export function TaskRows({
  groups,
  totalVisible,
  hasAnyTask,
  filtered,
  openTaskId,
  picked,
  sources,
  onOpen,
  onTogglePick,
  onClearFilters,
}: {
  groups: readonly TaskGroup[];
  totalVisible: number;
  hasAnyTask: boolean;
  filtered: boolean;
  openTaskId: string | null;
  picked: PickedIds;
  /** Looked up per row for the "List" meta segment — omitted for the unnamed
   * global source, matching `TaskDetail`'s own "nothing at all" convention. */
  sources: readonly TaskSource[];
  onOpen: (task: Task) => void;
  onTogglePick: (id: string) => void;
  onClearFilters: () => void;
}) {
  const sourceNames = useMemo(
    () => new Map(sources.map((s) => [s.id, s.name] as const)),
    [sources],
  );

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
    <div className="tasks-mrows">
      {groups.flatMap((g) => g.tasks).map((task) => {
        const done = task.lane === "done";
        const isPicked = picked.has(task.id);
        const sourceName = sourceNames.get(task.sourceId);

        const meta: ReactNode[] = [];
        if (task.labels.length > 0) {
          meta.push(
            <span className="tasks-mrow-labels">
              {task.labels.map((label) => {
                const style = labelChipStyle(label);
                return (
                  <span
                    key={label}
                    className="tasks-label-chip"
                    style={{ background: style.background, color: style.color }}
                  >
                    {label}
                  </span>
                );
              })}
            </span>,
          );
        }
        if (sourceName) {
          meta.push(<span className="tasks-mrow-source">{sourceName}</span>);
        }
        meta.push(
          <Tooltip content={task.id}>
            <span className="tasks-mrow-id">{task.id}</span>
          </Tooltip>,
        );
        meta.push(
          <span className="tasks-mrow-time">
            {formatRelativeTime(task.updatedAt)}
          </span>,
        );

        return (
          <div
            key={task.id}
            className={
              "tasks-mrow" +
              (done ? " tasks-row-done" : "") +
              (task.id === openTaskId ? " tasks-row-selected" : "")
            }
            role="button"
            tabIndex={0}
            aria-label={task.title}
            onClick={() => onOpen(task)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen(task);
              }
            }}
          >
            <button
              type="button"
              className="tasks-mrow-pick"
              aria-label={
                isPicked ? `Deselect "${task.title}"` : `Select "${task.title}"`
              }
              aria-pressed={isPicked}
              onClick={(e) => {
                e.stopPropagation();
                onTogglePick(task.id);
              }}
            >
              {isPicked && <Check size="0.85em" weight="bold" />}
            </button>
            <StatusGlyph lane={task.lane} />
            <div className="tasks-mrow-main">
              <div className="tasks-mrow-line1">
                <span className="tasks-mrow-title">{task.title}</span>
                <PriorityMark priority={task.priority} />
              </div>
              {task.descriptionPreview && (
                <div className="tasks-mrow-desc">{task.descriptionPreview}</div>
              )}
              <div className="tasks-mrow-meta">
                {meta.map((chunk, i) => (
                  <Fragment key={i}>
                    {i > 0 && (
                      <span className="tasks-mrow-sep" aria-hidden="true">
                        ·
                      </span>
                    )}
                    {chunk}
                  </Fragment>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
