/**
 * The sheet's create row — not a reuse of `QuickAdd`, whose own docstring is
 * explicit that it has no destination picker because the panel always targets
 * the active workspace. The sheet has no single active workspace to default
 * to, so it needs one: title, priority, labels, and which list the task lands
 * in. Submitting clears **only** the title and refocuses it — priority,
 * labels, and the picked list persist for the next task, so stamping out
 * several related tasks in a row doesn't mean re-picking them each time
 * (R9). Sheet-only; the panel keeps `QuickAdd`.
 *
 * The "New task" header is a collapse toggle — expanded by default; collapsed
 * it hides everything but the header so the list gets the dock's height back.
 * Priority, list, and labels share one wrapping row.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CaretDown, CaretRight, X } from "@phosphor-icons/react";
import { Button, Input, MenuButton, SegmentedTabs, type MenuEntry } from "@silo-code/sdk";
import {
  ALL_PRIORITIES,
  PRIORITY_LABELS,
  type TaskPriority,
} from "../model/task";
import type { TaskSource } from "../model/source";
import { focusWhenReady } from "../lib/focus";
import { labelChipStyle, parseLabels } from "../lib/labels";
import { NO_LIST_LABEL, sourcesMenu } from "../lib/menus";
import { PriorityMark } from "./glyphs";

export interface ComposerDraft {
  title: string;
  priority: TaskPriority;
  labels: string[];
}

export function Composer({
  sources,
  canSubmit,
  showMenu,
  onCreate,
  onNoDestination,
  focusSignal = 0,
}: {
  /** Every resolved source — the composer's list picker, unlike `QuickAdd`. */
  sources: readonly TaskSource[];
  /** False while sources are still resolving. */
  canSubmit: boolean;
  showMenu: (items: MenuEntry[], anchor: HTMLElement) => void;
  onCreate: (sourceId: string, draft: ComposerDraft) => void;
  onNoDestination: () => void;
  /**
   * Bumped by the parent (from the Navigator's "New task" button) to expand a
   * collapsed composer and focus the title input. `0` means no request.
   */
  focusSignal?: number;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [labels, setLabels] = useState<string[]>([]);
  const [labelDraft, setLabelDraft] = useState("");
  const [sourceId, setSourceId] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const wantFocusRef = useRef(false);

  useEffect(() => {
    if (focusSignal === 0) return;
    setCollapsed(false);
    wantFocusRef.current = true;
  }, [focusSignal]);

  // Runs after the title input has (re)mounted from the expand above.
  useEffect(() => {
    if (collapsed || !wantFocusRef.current) return;
    wantFocusRef.current = false;
    return focusWhenReady(() => titleRef.current);
  }, [collapsed, focusSignal]);

  const global = sources.find((s) => s.scope === "global");
  const destination =
    sources.find((s) => s.id === sourceId) ?? global ?? sources[0];

  function submit() {
    const trimmed = title.trim();
    if (trimmed === "") return;
    if (!canSubmit || !destination) {
      onNoDestination();
      return;
    }
    onCreate(destination.id, { title: trimmed, priority, labels });
    setTitle("");
    titleRef.current?.focus();
  }

  function onTitleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  }

  function addLabel() {
    const next = parseLabels(labelDraft);
    for (const label of next) {
      if (!labels.includes(label)) setLabels((ls) => [...ls, label]);
    }
    setLabelDraft("");
  }

  function onLabelKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      addLabel();
    }
  }

  return (
    <div className="tasks-composer">
      <button
        type="button"
        className="tasks-composer-hdr"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((c) => !c)}
      >
        <span>New task</span>
        {collapsed ? (
          <CaretRight size="1em" weight="bold" />
        ) : (
          <CaretDown size="1em" weight="bold" />
        )}
      </button>
      {!collapsed && (
        <>
          <Input
            ref={titleRef}
            block
            value={title}
            placeholder="New task…"
            aria-label="New task title"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={onTitleKeyDown}
          />
          <div className="tasks-composer-row">
            <div className="tasks-composer-field">
              <div className="tasks-detail-label">Priority</div>
              <SegmentedTabs
                tabs={ALL_PRIORITIES.map((p) => ({
                  id: p,
                  label: PRIORITY_LABELS[p],
                  icon: <PriorityMark priority={p} />,
                }))}
                active={priority}
                onSelect={setPriority}
              />
            </div>
            <div className="tasks-composer-field">
              <div className="tasks-detail-label">List</div>
              <MenuButton
                variant="field"
                label={
                  sources.length === 0
                    ? "No list available"
                    : destination?.name || NO_LIST_LABEL
                }
                disabled={sources.length === 0}
                onClick={(e) =>
                  showMenu(
                    sourcesMenu(sources, destination?.id, setSourceId),
                    e.currentTarget,
                  )
                }
              />
            </div>
            <div className="tasks-composer-field tasks-composer-field-labels">
              <div className="tasks-detail-label">Labels</div>
              <div className="tasks-composer-labels">
                {labels.map((label) => {
                  const style = labelChipStyle(label);
                  return (
                    <button
                      key={label}
                      type="button"
                      className="tasks-label-chip tasks-composer-chip"
                      style={{ background: style.background, color: style.color }}
                      aria-label={`Remove label "${label}"`}
                      onClick={() =>
                        setLabels((ls) => ls.filter((l) => l !== label))
                      }
                    >
                      {label}
                      <X size="0.8em" weight="bold" />
                    </button>
                  );
                })}
                <Input
                  className="tasks-composer-label-input"
                  value={labelDraft}
                  placeholder="+ label"
                  aria-label="Add a label"
                  onChange={(e) => setLabelDraft(e.target.value)}
                  onKeyDown={onLabelKeyDown}
                  onBlur={addLabel}
                />
              </div>
            </div>
          </div>
          <Button
            variant="primary"
            className="tasks-composer-add"
            disabled={title.trim() === ""}
            onClick={submit}
          >
            Add
          </Button>
        </>
      )}
    </div>
  );
}
