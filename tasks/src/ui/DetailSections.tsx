/**
 * The generic descriptor renderer. Knows the three `kind`s and nothing about
 * which provider produced a section — an unknown `kind` returns `null` (a newer
 * provider degrades to "section missing", never a crash). An editable section
 * (carrying `key` + `editable`) gets an editor appropriate to its `kind`, and
 * the edit travels back as `providerFields[key]`.
 */

import { useEffect, useState } from "react";
import { AddRow, CheckboxRow, IconButton, Input, Textarea } from "@silo-code/sdk";
import { X } from "@phosphor-icons/react";
import {
  isEditableSection,
  type ChecklistItem,
  type DetailSection,
} from "../model/detail";

export function DetailSections({
  sections,
  onEdit,
}: {
  sections: readonly DetailSection[];
  onEdit: (key: string, value: unknown) => void;
}) {
  if (sections.length === 0) return null;
  return (
    <div className="tasks-detail-sections">
      {sections.map((section, i) => (
        <SectionView key={section.key ?? `${section.kind}-${i}`} section={section} onEdit={onEdit} />
      ))}
    </div>
  );
}

function SectionView({
  section,
  onEdit,
}: {
  section: DetailSection;
  onEdit: (key: string, value: unknown) => void;
}) {
  const editable = isEditableSection(section);
  const label =
    section.kind === "text" ? section.label ?? "Notes" : section.label;

  if (section.kind === "text") {
    return (
      <div className="tasks-detail-field">
        <div className="tasks-detail-label">{label}</div>
        {editable ? (
          <TextEditor
            value={section.value}
            placeholder="Add a description…"
            onCommit={(v) => onEdit(section.key, v)}
          />
        ) : (
          <p className="tasks-detail-text">{section.value || "—"}</p>
        )}
      </div>
    );
  }

  if (section.kind === "field") {
    return (
      <div className="tasks-detail-field">
        <div className="tasks-detail-label">{label}</div>
        {editable ? (
          section.format === "date" ? (
            <input
              type="date"
              className="tasks-date-input"
              value={section.value}
              onChange={(e) => onEdit(section.key, e.target.value)}
            />
          ) : (
            <FieldEditor
              value={section.value}
              onCommit={(v) => onEdit(section.key, v)}
            />
          )
        ) : (
          <p className="tasks-detail-text">{section.value || "—"}</p>
        )}
      </div>
    );
  }

  if (section.kind === "checklist") {
    return (
      <div className="tasks-detail-field">
        <div className="tasks-detail-label">{label}</div>
        {editable ? (
          <ChecklistEditor
            items={section.items}
            onCommit={(items) => onEdit(section.key, items)}
          />
        ) : (
          <ul className="tasks-detail-checklist">
            {section.items.map((item, i) => (
              <li key={i} className={item.done ? "is-done" : undefined}>
                {item.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // Unknown kind — degrade to "section missing".
  return null;
}

function TextEditor({
  value,
  placeholder,
  onCommit,
}: {
  value: string;
  placeholder?: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <Textarea
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
    />
  );
}

function FieldEditor({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <Input
      block
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
    />
  );
}

function ChecklistEditor({
  items,
  onCommit,
}: {
  items: readonly ChecklistItem[];
  onCommit: (items: ChecklistItem[]) => void;
}) {
  const [adding, setAdding] = useState("");
  return (
    <div className="tasks-checklist-editor">
      {items.map((item, i) => (
        <div className="tasks-checklist-row" key={i}>
          <CheckboxRow
            label={item.text}
            checked={item.done}
            onChange={(done) =>
              onCommit(items.map((it, j) => (j === i ? { ...it, done } : it)))
            }
          />
          <IconButton
            size="sm"
            aria-label={`Remove "${item.text}"`}
            onClick={() => onCommit(items.filter((_, j) => j !== i))}
          >
            <X size="1em" />
          </IconButton>
        </div>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const text = adding.trim();
          if (!text) return;
          onCommit([...items, { text, done: false }]);
          setAdding("");
        }}
      >
        <Input
          block
          value={adding}
          placeholder="Add a criterion…"
          onChange={(e) => setAdding(e.target.value)}
        />
        <AddRow type="submit">Add criterion</AddRow>
      </form>
    </div>
  );
}
