/**
 * One task row: **status glyph · title · priority**. One line. The id lives in
 * the row's `Tooltip` and nowhere else in the row (R7); the provider a task
 * came from is not shown at all.
 */

import { Tooltip } from "@silo-code/sdk";
import type { Task } from "../model/task";
import { PriorityMark, StatusGlyph } from "./glyphs";

export function TaskRow({
  task,
  selected,
  onOpen,
}: {
  task: Task;
  selected: boolean;
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
      <Tooltip content={task.id}>
        <span className="tasks-row-title">{task.title}</span>
      </Tooltip>
      <PriorityMark priority={task.priority} />
    </div>
  );
}
