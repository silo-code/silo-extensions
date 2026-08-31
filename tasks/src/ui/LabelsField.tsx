/**
 * The core `labels` field on the detail page. Labels render as filled colored
 * chips (color per {@link labelChipStyle}, GitHub-issue-label style); a pencil
 * swaps the row for a comma-separated text input — the same edit affordance
 * `InlineEdit` gives the other core fields, specialised for a chip list.
 *
 * While editing, the field registers with the SDK's two-stage-Escape
 * controller ({@link setActiveInlineEditCancel}) so the panel's Escape handler
 * cancels the edit before it pops the detail page.
 */

import { useEffect, useState } from "react";
import { PencilSimple } from "@phosphor-icons/react";
import {
  IconButton,
  Input,
  Tooltip,
  setActiveInlineEditCancel,
} from "@silo-code/sdk";
import { labelChipStyle, parseLabels } from "../lib/labels";

export function LabelsField({
  labels,
  onChange,
}: {
  labels: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;

  useEffect(() => {
    if (!editing) return;
    setActiveInlineEditCancel(() => setDraft(null));
    return () => setActiveInlineEditCancel(null);
  }, [editing]);

  if (draft !== null) {
    const commit = () => {
      const next = parseLabels(draft);
      if (next.join("\n") !== labels.join("\n")) onChange(next);
      setDraft(null);
    };
    return (
      <Input
        block
        autoFocus
        value={draft}
        placeholder="Comma-separated labels"
        aria-label="Labels (comma separated)"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
      />
    );
  }

  return (
    <div className="tasks-labels">
      {labels.length === 0 ? (
        <span className="tasks-labels-empty">None</span>
      ) : (
        labels.map((label) => {
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
        })
      )}
      <Tooltip content="Edit labels">
        <IconButton
          size="sm"
          aria-label="Edit labels"
          onClick={() => setDraft(labels.join(", "))}
        >
          <PencilSimple size="1em" />
        </IconButton>
      </Tooltip>
    </div>
  );
}
