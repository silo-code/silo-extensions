/**
 * The sheet's batch bar. Each action fans out over the existing single-task
 * provider methods (`setLane` / `updateTask`); there is no new `TaskProvider`
 * capability (R9). Sheet-only.
 *
 * While nothing is picked (R15), this renders a select-all strip instead of
 * returning `null` — the always-visible checkbox convention (R12) needs a
 * "select all" affordance now that it has no table header row to live in;
 * this occupies the same layout slot the action bar takes once `count > 0`,
 * so the list doesn't shift.
 */

import { useState, type KeyboardEvent } from "react";
import { Check, Minus } from "@phosphor-icons/react";
import { Input, MenuButton, type MenuEntry } from "@silo-code/sdk";
import { batchLaneMenu, batchPriorityMenu } from "../lib/menus";
import type { TaskLane, TaskPriority } from "../model/task";

export function BatchBar({
  count,
  totalVisible,
  allPicked,
  showMenu,
  onSetLane,
  onSetPriority,
  onAddLabel,
  onDelete,
  onToggleAll,
  onClear,
}: {
  count: number;
  /** Rows currently on screen — for the idle strip's "N tasks" and to hide
   * the strip entirely when the list is empty. */
  totalVisible: number;
  /** Whether every visible row is picked — the select-all checkbox's
   * checked (vs. indeterminate) state. */
  allPicked: boolean;
  showMenu: (items: MenuEntry[], anchor: HTMLElement) => void;
  onSetLane: (lane: TaskLane) => void;
  onSetPriority: (priority: TaskPriority) => void;
  onAddLabel: (label: string) => void;
  /** Delete every picked task (fans out over `deleteTask`), after a confirm. */
  onDelete: () => void;
  onToggleAll: () => void;
  onClear: () => void;
}) {
  const [labelDraft, setLabelDraft] = useState("");

  if (totalVisible === 0) return null;

  if (count === 0) {
    return (
      <div className="tasks-batchbar tasks-batchbar-idle" role="status">
        <button
          type="button"
          className="tasks-mrow-pick"
          aria-label="Select all"
          aria-pressed={false}
          onClick={onToggleAll}
        />
        <span className="tasks-batchbar-count">
          {totalVisible} task{totalVisible === 1 ? "" : "s"}
        </span>
      </div>
    );
  }

  function submitLabel() {
    const trimmed = labelDraft.trim();
    if (!trimmed) return;
    onAddLabel(trimmed);
    setLabelDraft("");
  }

  function onLabelKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      submitLabel();
    }
  }

  return (
    <div className="tasks-batchbar" role="status">
      <button
        type="button"
        className="tasks-mrow-pick tasks-mrow-pick-active"
        aria-label={allPicked ? "Deselect all" : "Select all"}
        aria-pressed={allPicked}
        onClick={onToggleAll}
      >
        {allPicked ? (
          <Check size="0.85em" weight="bold" />
        ) : (
          <Minus size="0.85em" weight="bold" />
        )}
      </button>
      <span className="tasks-batchbar-count">
        {count} selected
      </span>
      <MenuButton
        size="sm"
        className="tasks-menu-btn"
        label="Set status"
        onClick={(e) => showMenu(batchLaneMenu(onSetLane), e.currentTarget)}
      />
      <MenuButton
        size="sm"
        className="tasks-menu-btn"
        label="Set priority"
        onClick={(e) =>
          showMenu(batchPriorityMenu(onSetPriority), e.currentTarget)
        }
      />
      <Input
        className="tasks-batchbar-label"
        value={labelDraft}
        placeholder="Add label…"
        aria-label="Add a label to the selection"
        onChange={(e) => setLabelDraft(e.target.value)}
        onKeyDown={onLabelKeyDown}
        onBlur={submitLabel}
      />
      <span className="tasks-batchbar-spacer" />
      <button
        type="button"
        className="tasks-batchbar-danger"
        onClick={onDelete}
      >
        Delete
      </button>
      <button type="button" className="tasks-batchbar-clear" onClick={onClear}>
        Clear
      </button>
    </div>
  );
}
