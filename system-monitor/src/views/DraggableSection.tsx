import { useRef, useState } from "react";
import { Section, Switch } from "@silo-code/sdk";
import { GripIcon } from "../icons";
import type { PanelId } from "../store";

export interface DraggableItem {
  id: PanelId;
  label: string;
  hint: string;
  enabled: boolean;
}

export function DraggableSection({
  title,
  items,
  onToggle,
  onReorder,
}: {
  /** Omit when the caller already labels this list some other way (e.g. a tab). */
  title?: string;
  items: DraggableItem[];
  onToggle: (id: PanelId, next: boolean) => void;
  onReorder: (from: number, to: number) => void;
}) {
  const dragIndex = useRef<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);

  function onDragStart(i: number) {
    dragIndex.current = i;
  }

  function onDragOver(e: React.DragEvent, i: number) {
    e.preventDefault();
    if (
      dragIndex.current !== null &&
      dragIndex.current !== i &&
      dropTarget !== i
    ) {
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

  const rows = (
    <div className="sms-draggable-rows" onDragLeave={() => setDropTarget(null)}>
      {items.map((item, i) => (
        <div
          key={item.id}
          className={[
            "sms-draggable-row",
            dragIndex.current === i ? "sms-dragging" : "",
            dropTarget === i ? "sms-drop-target" : "",
          ].join(" ")}
          draggable
          onDragStart={() => onDragStart(i)}
          onDragOver={(e) => onDragOver(e, i)}
          onDrop={() => onDrop(i)}
          onDragEnd={reset}
        >
          <div className="sms-draggable-row-text">
            <span className="sms-draggable-row-label">{item.label}</span>
            <span className="sms-draggable-row-hint">{item.hint}</span>
          </div>
          <div className="sms-panel-controls">
            <Switch
              checked={item.enabled}
              onChange={(next) => onToggle(item.id, next)}
              aria-label={`Show ${item.label}`}
            />
            <span className="sms-grip" title="Drag to reorder" aria-hidden>
              <GripIcon />
            </span>
          </div>
        </div>
      ))}
    </div>
  );

  return title ? <Section label={title}>{rows}</Section> : rows;
}
