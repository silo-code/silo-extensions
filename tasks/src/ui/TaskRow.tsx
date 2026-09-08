/**
 * One task row: **status glyph · title · priority**. One line. Hovering the
 * title opens a {@link TaskHoverCard} with the rest of the task's detail (the
 * row body deliberately shows almost none of it — R7).
 */

import type { Task } from "../model/task";
import { PriorityMark, StatusGlyph } from "./glyphs";
import { HoverCard } from "./HoverCard";
import { TaskHoverCard } from "./TaskHoverCard";

export function TaskRow({
  task,
  selected,
  sourceName,
  onOpen,
}: {
  task: Task;
  selected: boolean;
  /** The task's list — shown in the hover card; omitted for the global list. */
  sourceName?: string;
  onOpen: () => void;
}) {
  const done = task.lane === "done";
  return (
    <div
      className={
        "tasks-row" +
        (done ? " tasks-row-done" : "") +
        (selected ? " tasks-row-selected" : "")
      }
      role="button"
      tabIndex={0}
      aria-label={task.title}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <StatusGlyph lane={task.lane} />
      <HoverCard card={<TaskHoverCard task={task} sourceName={sourceName} />}>
        <span className="tasks-row-title">{task.title}</span>
      </HoverCard>
      <PriorityMark priority={task.priority} />
    </div>
  );
}
