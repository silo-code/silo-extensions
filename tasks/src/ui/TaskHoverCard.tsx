/**
 * The hover card shown for a list row (`TaskRow`) — everything the core
 * {@link Task} model carries, since the row itself only shows status · title ·
 * priority. Passed as the SDK `Tooltip`'s `content`, so it inherits the
 * tooltip's portal, hover delay, and viewport clamping; the card just styles
 * the inside.
 *
 * Rich provider fields (full description, due date, acceptance criteria) are
 * **not** here — they load asynchronously per task via `sourceSet.detail`, and
 * a hover card can't wait on that. `descriptionPreview` is the one bit of
 * description the core model already carries.
 */

import type { Task } from "../model/task";
import { LANE_LABELS, PRIORITY_LABELS } from "../model/task";
import { labelChipStyle } from "../lib/labels";
import { formatRelativeTime } from "../lib/time";
import { PriorityMark, StatusGlyph } from "./glyphs";

export function TaskHoverCard({
  task,
  sourceName,
}: {
  task: Task;
  /** The list the task belongs to — omitted for the unnamed global source. */
  sourceName?: string;
}) {
  return (
    <div className="tasks-tipcard">
      <div className="tasks-tipcard-title">{task.title}</div>
      <div className="tasks-tipcard-meta">
        <span className="tasks-tipcard-metaitem">
          <StatusGlyph lane={task.lane} />
          {task.statusLabel || LANE_LABELS[task.lane]}
        </span>
        {task.priority !== "normal" && (
          <span className="tasks-tipcard-metaitem">
            <PriorityMark priority={task.priority} />
            {PRIORITY_LABELS[task.priority]}
          </span>
        )}
        {sourceName && (
          <span className="tasks-tipcard-metaitem">{sourceName}</span>
        )}
      </div>
      {task.labels.length > 0 && (
        <div className="tasks-tipcard-labels">
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
        </div>
      )}
      {task.descriptionPreview && (
        <div className="tasks-tipcard-desc">{task.descriptionPreview}</div>
      )}
      <div className="tasks-tipcard-foot">
        <span className="tasks-tipcard-id">{task.id}</span>
        <span aria-hidden="true">·</span>
        <span>updated {formatRelativeTime(task.updatedAt)}</span>
      </div>
    </div>
  );
}
