/**
 * One row in the Navigator's Follow-ups view, built to the shape
 * `/design/surfaces#row-anatomy` documents — the Agents panel's chassis, so
 * every Navigator view reads as one surface:
 *
 *   ⚑ Generic types file editing           ← title line: leading icon + title
 *   ▦ silo-extensions · Blocked · 9h       ← subtitle: identity/location, muted
 *   waiting on Ana's reply                 ← the note, only when there is one
 *
 * The leading icon is the **first child of the title line**, not a sibling of
 * the text block — that's what puts the subtitle's own icon on the same left
 * edge as it, rather than indented under the title text.
 *
 * One deliberate departure from the guide, noted here so a later reader
 * doesn't "fix" it back: the leading icon is painted with the **label's**
 * color rather than `--silo-color-text`. The guide's rule is that the icon
 * identifies the row; here the color *is* the identity — it's the same five
 * theme tokens the host paints the tab tint with, so a row and its tab agree
 * at a glance. A uniform gray flag on every row would throw that away.
 *
 * Relabel / note / clear live on the row's **right-click menu**, not on an
 * inline button: a row's trailing edge is for status, and a `⋯` that appears
 * on hover competes with the click target for the same pixels. Right-click is
 * also where a user already looks for exactly these verbs — it's what the tab
 * context menus offer.
 *
 * Both icon sizes are pinned in CSS (16px leading, 12px subtitle), never via
 * a `size` prop — see `glyphs.tsx`. The note is a third line below the
 * subtitle, built to the guide's own optional-third-line values.
 *
 * Every row is clickable, and every row lands on its own tab — `panels.focus`
 * and `editors.focus` reach a dock panel, an untitled buffer, and a diff alike.
 */

import { Fragment } from "react";
import { Tooltip } from "@silo-code/sdk";
import type { FollowUpLabel } from "../lib/labels";
import { labelById } from "../lib/labels";
import { formatElapsed } from "../lib/time";
import type { FollowUpItem } from "../lib/view";
import { LabelFlag, WorkspaceGlyph, kindName } from "./glyphs";

export function FollowUpRow({
  item,
  labels,
  showWorkspace,
  showLabel,
  current,
  onOpen,
  onMenu,
}: {
  item: FollowUpItem;
  labels: readonly FollowUpLabel[];
  showWorkspace: boolean;
  showLabel: boolean;
  /** This row *is* the tab on screen right now. At most one row in the view. */
  current: boolean;
  onOpen: () => void;
  /** Opens the follow-up menu at a right-click's viewport point. */
  onMenu: (at: { x: number; y: number }) => void;
}) {
  const label = labelById(labels, item.labelId);
  const age = formatElapsed(item.markedAt);
  // The group header already states whichever axis the list is grouped by —
  // repeating it on every row inside that group is noise in the narrowest
  // column in the app. Each field is its own element, joined by standalone
  // `·` spans, so only the workspace name truncates when the panel narrows.
  const fields = [
    showWorkspace ? (
      <>
        <WorkspaceGlyph />
        <span className="fu-row-ws">{item.workspaceName}</span>
      </>
    ) : null,
    showLabel ? <span>{label.name}</span> : null,
    <span>{age}</span>,
  ].filter((f) => f !== null);

  return (
    <div
      className={current ? "fu-row fu-row-current" : "fu-row"}
      role="button"
      tabIndex={0}
      aria-current={current ? "true" : undefined}
      aria-label={`${label.name}: ${item.title} (${kindName(item.kind)})`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      // `preventDefault` so the host's own empty-area menu doesn't open on
      // top of this one. The browser fires this for the keyboard Menu key and
      // Shift+F10 as well, so the menu is reachable without a mouse.
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <div className="fu-row-text">
        <div className="fu-row-title-line">
          <LabelFlag labelId={label.id} className="fu-row-icon" />
          <Tooltip
            content={`${kindName(item.kind)} · ${item.filePath ?? item.title}`}
          >
            <span className="fu-row-title">{item.title}</span>
          </Tooltip>
        </div>
        <div className="fu-row-subtitle">
          {fields.map((field, i) => (
            <Fragment key={i}>
              {i > 0 && <span aria-hidden="true">·</span>}
              {field}
            </Fragment>
          ))}
        </div>
        {item.note !== "" && <div className="fu-row-note">{item.note}</div>}
      </div>
    </div>
  );
}
