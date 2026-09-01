/**
 * The two row indicators — status and priority. Phosphor at `size="1em"` so
 * they track the pane's font size / `uiFontSize`.
 */

import {
  CaretDoubleDown,
  CaretDoubleUp,
  CheckCircle,
  Circle,
  CircleHalf,
  Prohibit,
} from "@phosphor-icons/react";
import type { TaskLane, TaskPriority } from "../model/task";

const STATUS_TITLE: Record<TaskLane, string> = {
  todo: "Ready",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};

/**
 * Status as a **glyph, not a section header**: hollow ring (ready), half-filled
 * (in progress), struck ring (blocked), filled check (done).
 */
export function StatusGlyph({ lane }: { lane: TaskLane }) {
  const cls = (mod: string) => `tasks-status-glyph tasks-status-${mod}`;
  switch (lane) {
    case "todo":
      return (
        <Circle
          size="1em"
          className={cls("todo")}
          aria-label={STATUS_TITLE.todo}
        />
      );
    case "in_progress":
      return (
        <CircleHalf
          size="1em"
          weight="fill"
          className={cls("in-progress")}
          aria-label={STATUS_TITLE.in_progress}
        />
      );
    case "blocked":
      return (
        <Prohibit
          size="1em"
          weight="bold"
          className={cls("blocked")}
          aria-label={STATUS_TITLE.blocked}
        />
      );
    case "done":
      return (
        <CheckCircle
          size="1em"
          weight="fill"
          className={cls("done")}
          aria-label={STATUS_TITLE.done}
        />
      );
  }
}

/**
 * Priority as a double chevron, small and bold: high points up in a warm orange
 * (a warn/err mix) so it carries across a dense list; low points down in the
 * muted row tone. Normal is the default and shows no mark at all.
 */
export function PriorityMark({ priority }: { priority: TaskPriority }) {
  switch (priority) {
    case "high":
      return (
        <CaretDoubleUp
          size="0.95em"
          weight="bold"
          className="tasks-priority-mark tasks-priority-high"
          aria-label="High priority"
        />
      );
    case "low":
      return (
        <CaretDoubleDown
          size="0.95em"
          weight="bold"
          className="tasks-priority-mark tasks-priority-low"
          aria-label="Low priority"
        />
      );
    case "normal":
      return null;
  }
}
