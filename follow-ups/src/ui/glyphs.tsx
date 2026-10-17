/**
 * The small visuals shared by the dropdown, the Navigator rows, and the
 * settings page.
 *
 * No hardcoded color anywhere: a label's identity color is one of the five
 * host semantic tokens, reached either through the kit's `BadgeTone` or
 * through a `fu-swatch-*` class that sets `color` from a `--silo-color-*`
 * token. Both track the user's theme preset.
 */

import { Flag, SquaresFour } from "@phosphor-icons/react";
import type { LabelId } from "../lib/labels";
import type { PanelKind } from "../lib/store";

/**
 * A label's color as a bare dot — sized for a menu row's 1em leading gutter,
 * where a pill would crowd the label name beside it.
 */
export function LabelDot({ labelId }: { labelId: LabelId }) {
  return (
    <span className={`fu-swatch fu-swatch-${labelId}`} aria-hidden="true" />
  );
}

/**
 * A label's color as a filled flag — the mark used wherever a label appears
 * next to its own name: the Navigator row and the settings list.
 *
 * Deliberately not an empty `Badge`: a badge with no children collapses to a
 * sliver, so the color it was carrying never actually showed. The color comes
 * from the `fu-swatch-*` class, which sets nothing but `color` from a
 * `--silo-color-*` token, so it tracks the theme exactly as the tab tint does.
 *
 * **No `size` prop.** Phosphor's own default is `1em`, which is what the
 * settings list wants; the Navigator row passes `fu-row-icon` and pins 16px
 * in CSS, per `/design/surfaces#row-anatomy` — a relative size on a row icon
 * is the documented way this pattern goes wrong.
 */
export function LabelFlag({
  labelId,
  className,
}: {
  labelId: LabelId;
  className?: string;
}) {
  return (
    <span
      className={`fu-flag fu-swatch-${labelId}${className ? ` ${className}` : ""}`}
      aria-hidden="true"
    >
      <Flag weight="fill" />
    </span>
  );
}

/**
 * The workspace a Navigator row's tab lives in — drawn immediately before the
 * workspace name on the row's meta line.
 *
 * This slot used to hold a glyph for the tab's *kind* (file / terminal /
 * panel), which put a file icon in front of a workspace name and read as if
 * the workspace were the file. The kind is still in the row's `aria-label`
 * and its tooltip; it just isn't worth a second glyph in the narrowest column
 * in the app, where the title above already says which tab this is.
 *
 * The glyph is the host's own workspace mark: `SquaresFour`, the same icon
 * the Workspaces panel and the Agents panel draw beside a workspace name — so
 * a workspace is named the same way here as in the panels the user learned it
 * from.
 *
 * `fill`, not `duotone`. The host uses both, for two different sizes: the
 * standalone Workspaces panel draws it duotone in a tall list row, the Agents
 * panel draws it filled in a compact row exactly like this one. Duotone's
 * second tone is mostly translucent, which washes the glyph out at an inline
 * size — so the compact-row usage is the one to copy.
 *
 * Size is **12px, pinned in CSS** — deliberately smaller than the title
 * line's 16px icon, and deliberately not a `size` prop: a relative size here
 * is exactly what the guide calls out as having produced an oversized
 * workspace mark. `opacity: 0.75` rather than a color of its own, so it
 * inherits the subtitle line's `text-lo`.
 */
export function WorkspaceGlyph() {
  return (
    <span className="fu-ws" aria-hidden="true">
      <SquaresFour weight="fill" />
    </span>
  );
}

/** Human name for a kind — the spoken half of a row's `aria-label`. */
export function kindName(kind: PanelKind): string {
  if (kind === "editor") return "Editor";
  if (kind === "terminal") return "Terminal";
  return "Panel";
}
