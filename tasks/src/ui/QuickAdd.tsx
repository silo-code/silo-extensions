/**
 * The create row — docked at the **bottom** of the panel: a title input with a
 * **square primary Add button to its right** (`Plus` icon only). Enter also
 * submits; the button enables only when the input has text. No destination
 * picker: the panel always creates in the active workspace's source (the global
 * list when no workspace is open).
 */

import { useState, type KeyboardEvent } from "react";
import { Plus } from "@phosphor-icons/react";
import { Button, Input } from "@silo-code/sdk";

export function QuickAdd({
  destinationName,
  canSubmit,
  onCreate,
  onNoDestination,
}: {
  /** The name of the source new tasks land in — shown in the button tooltip. */
  destinationName: string | undefined;
  /** False while sources are still resolving. */
  canSubmit: boolean;
  onCreate: (title: string) => void;
  /** Called when submit is attempted before a source has resolved. */
  onNoDestination: () => void;
}) {
  const [title, setTitle] = useState("");
  const trimmed = title.trim();

  function submit() {
    if (trimmed === "") return;
    if (!canSubmit) {
      onNoDestination();
      return;
    }
    onCreate(trimmed);
    setTitle("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  }

  const label = destinationName ? `Add task to ${destinationName}` : "Add task";

  return (
    <div className="tasks-quickadd">
      <Input
        block
        value={title}
        placeholder="New task…"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={onKeyDown}
        aria-label="New task title"
      />
      <Button
        variant="primary"
        className="tasks-add-btn"
        aria-label={label}
        disabled={trimmed === ""}
        onClick={submit}
      >
        <Plus size="1em" weight="bold" />
      </Button>
    </div>
  );
}
