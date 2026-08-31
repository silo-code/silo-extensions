/**
 * The drill-in detail page. Replaces the list entirely (search + toolbar
 * unmount, not hide). Follows the shared side-panel detail-header pattern
 * (docs/side-panel-design.md › Drill-in): a quiet `.panel-back` control leads a
 * toolbar row with secondary icon-tools right-aligned; the bold title and its
 * primary action button sit on the row below. `Escape` pops one page (handled
 * by the panel root).
 *
 * Core fields (title, lane, priority, labels) are edited here directly; every
 * non-core field reaches the UI as a provider {@link DetailSection} and its
 * edit travels back as `providerFields[key]`.
 */

import { CaretLeft, Trash } from "@phosphor-icons/react";
import { IconButton, InlineEdit, SegmentedTabs, Tooltip } from "@silo-code/sdk";
import type { DetailSection } from "../model/detail";
import {
  ALL_LANES,
  ALL_PRIORITIES,
  LANE_LABELS,
  PRIORITY_LABELS,
  type Task,
  type TaskPatch,
} from "../model/task";
import type { TaskSource } from "../model/source";
import { DetailSections } from "./DetailSections";
import { PriorityMark } from "./glyphs";
import { LabelsField } from "./LabelsField";

export function TaskDetail({
  task,
  source,
  workspaceName,
  sections,
  onBack,
  onPatch,
  onComplete,
  onDelete,
}: {
  task: Task;
  source: TaskSource;
  /** Set when the source is workspace-scoped. */
  workspaceName?: string;
  sections: readonly DetailSection[];
  onBack: () => void;
  onPatch: (patch: TaskPatch) => void;
  onComplete: () => void;
  onDelete: () => void;
}) {
  const editProviderField = (key: string, value: unknown) =>
    onPatch({ providerFields: { [key]: value } });

  // Split point for interleaving the core "Labels" field: everything up to and
  // including the first free-form text section renders above Labels, the rest
  // below. `findIndex` → -1 when a provider surfaces no text section, so the
  // slice is `[0, 0)` and Labels leads the provider sections.
  const afterDescription =
    sections.findIndex((s) => s.kind === "text") + 1;

  return (
    <div className="tasks-detail silo-scroll">
      <div className="tasks-detail-backrow">
        <button type="button" className="panel-back" onClick={onBack}>
          <CaretLeft size={14} weight="bold" />
          Back
        </button>
        <div className="tasks-detail-backrow-tools">
          <Tooltip content="Delete task">
            <IconButton
              size="sm"
              variant="toolbar"
              aria-label="Delete task"
              onClick={onDelete}
            >
              <Trash size="1em" />
            </IconButton>
          </Tooltip>
        </div>
      </div>

      <div className="tasks-detail-titlerow">
        <InlineEdit
          value={task.title}
          onSave={(title) => onPatch({ title })}
          aria-label="Task title"
        />
        {task.lane !== "done" && (
          <div className="tasks-detail-cta">
            <button
              type="button"
              className="tasks-detail-btn tasks-detail-btn--primary"
              onClick={onComplete}
            >
              Complete
            </button>
          </div>
        )}
      </div>

      <div className="tasks-detail-field">
        <div className="tasks-detail-label">Lane</div>
        <SegmentedTabs
          tabs={ALL_LANES.map((lane) => ({
            id: lane,
            label: LANE_LABELS[lane],
          }))}
          active={task.lane}
          onSelect={(lane) => onPatch({ lane })}
        />
      </div>

      <div className="tasks-detail-field tasks-priority-field">
        <div className="tasks-detail-label">Priority</div>
        <SegmentedTabs
          tabs={ALL_PRIORITIES.map((priority) => ({
            id: priority,
            label: PRIORITY_LABELS[priority],
            icon: <PriorityMark priority={priority} />,
          }))}
          active={task.priority}
          onSelect={(priority) => onPatch({ priority })}
        />
      </div>

      {/* The free-form description block, then Labels (a core field) directly
          under it, then the remaining provider sections (due date, criteria…). */}
      <DetailSections
        sections={sections.slice(0, afterDescription)}
        onEdit={editProviderField}
      />

      <div className="tasks-detail-field">
        <div className="tasks-detail-label">Labels</div>
        <LabelsField
          labels={task.labels}
          onChange={(labels) => onPatch({ labels })}
        />
      </div>

      <DetailSections
        sections={sections.slice(afterDescription)}
        onEdit={editProviderField}
      />

      {/* Identity footer — read-only rows next to the provider's "Created"
          field rather than a subtitle under the task title. */}
      <div className="tasks-detail-field">
        <div className="tasks-detail-label">List</div>
        <p className="tasks-detail-text">{source.name}</p>
      </div>

      {workspaceName && workspaceName !== source.name && (
        <div className="tasks-detail-field">
          <div className="tasks-detail-label">Workspace</div>
          <p className="tasks-detail-text">{workspaceName}</p>
        </div>
      )}

      <div className="tasks-detail-field">
        <div className="tasks-detail-label">ID</div>
        <p className="tasks-detail-text tasks-detail-id">{task.id}</p>
      </div>
    </div>
  );
}
