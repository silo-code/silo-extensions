/**
 * The five label rows on the settings page: drag to reorder, click the name to
 * rename.
 *
 * **No add row and no delete button.** There is exactly one label per host
 * semantic color and the color *is* the label's identity, so the set is fixed
 * at five — which is also what keeps the tab tint theme-tracked instead of a
 * hardcoded hex.
 *
 * Drag-and-drop is plain HTML5 DnD, lifted from system-monitor's
 * `DraggableSection` — not `ctx.dnd`, which is for drags that cross surfaces.
 * Rows are keyed on the label id, never the index, so a drop doesn't remount
 * the row that moved.
 *
 * **The default is not set from here.** It used to be a radio per row, which
 * put a five-wide control column in front of names that are the point of the
 * list, and made "which one does the Flag button use" a thing you deduce from
 * which dot is filled. Picking it now belongs to a single `Select` on the
 * settings page; all this list carries is a read-only `Default` chip on the
 * one that won, so the answer is still visible where the labels are without
 * the list owning the decision.
 */

import { useRef, useState } from "react";
import { Badge, InlineEdit } from "@silo-code/sdk";
import { DotsSixVertical } from "@phosphor-icons/react";
import {
  validateLabelName,
  type FollowUpLabel,
} from "../lib/labels";
import { LabelFlag } from "./glyphs";

export function LabelList({
  labels,
  onRename,
  onReorder,
}: {
  labels: readonly FollowUpLabel[];
  onRename: (labelId: string, name: string) => void;
  onReorder: (from: number, to: number) => void;
}) {
  const dragIndex = useRef<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);

  function onDragOver(e: React.DragEvent, i: number) {
    e.preventDefault();
    if (dragIndex.current !== null && dragIndex.current !== i && dropTarget !== i) {
      setDropTarget(i);
    }
  }

  function onDrop(targetIndex: number) {
    const from = dragIndex.current;
    if (from !== null && from !== targetIndex) onReorder(from, targetIndex);
    reset();
  }

  function reset() {
    dragIndex.current = null;
    setDropTarget(null);
  }

  return (
    <div className="fu-label-rows" onDragLeave={() => setDropTarget(null)}>
      {labels.map((label, i) => (
        <div
          key={label.id}
          className={[
            "fu-label-row",
            dropTarget === i ? "fu-drop-target" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          draggable
          onDragStart={() => {
            dragIndex.current = i;
          }}
          onDragOver={(e) => onDragOver(e, i)}
          onDrop={() => onDrop(i)}
          onDragEnd={reset}
        >
          <span className="fu-grip" title="Drag to reorder" aria-hidden="true">
            <DotsSixVertical size="1em" weight="bold" />
          </span>
          <LabelFlag labelId={label.id} />
          <div className="fu-label-name">
            {/* No Escape handler here on purpose — the host coordinates the
                two-stage Escape (cancel the edit, then close the dialog)
                through the SDK's own `setActiveInlineEditCancel` hook. */}
            <InlineEdit
              value={label.name}
              onSave={(name) => onRename(label.id, name)}
              validate={(v) => validateLabelName(labels, label.id, v)}
              aria-label={`Rename the ${label.name} label`}
            />
          </div>
          {label.isDefault ? (
            <Badge tone="outline" size="sm">
              Default
            </Badge>
          ) : null}
        </div>
      ))}
    </div>
  );
}
