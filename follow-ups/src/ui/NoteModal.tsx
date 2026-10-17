/**
 * The follow-up note editor, shown via `ctx.ui.showModal`.
 *
 * The note is the "why" the tab's color alone can't carry — a line of
 * free text that shows up in the dropdown and on the Navigator row.
 */

import { useState } from "react";
import { Button, ModalActions, Textarea } from "@silo-code/sdk";

export function NoteModal({
  initial,
  labelName,
  onSave,
  onCancel,
}: {
  initial: string;
  /** The follow-up's label, so the modal says what it's a note *on*. */
  labelName: string;
  onSave: (note: string) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState(initial);
  const trimmed = note.trim();
  return (
    <div className="fu-note-modal">
      <p className="fu-note-hint">
        A line about what you're waiting on. Shows on the Follow-ups view and
        in the tab's follow-up menu — the tab itself still shows only the
        color.
      </p>
      <Textarea
        className="fu-note-input"
        value={note}
        autoFocus
        rows={4}
        placeholder={`Why is this "${labelName}"?`}
        aria-label="Follow-up note"
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          // Enter inserts a newline (it's a textarea); the modifier chord is
          // the save gesture, matching every other multiline field in Silo.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSave(trimmed);
          }
        }}
      />
      <ModalActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={() => onSave(trimmed)}>
          Save
        </Button>
      </ModalActions>
    </div>
  );
}
