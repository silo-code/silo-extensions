/**
 * The Flag control's toolbar contributions, as data.
 *
 * Built here rather than inline in `activate` so the shape is testable without
 * a host: one **split control** per surface — a command item carrying
 * `dropdown`, which the host draws as one welded unit whose left half runs the
 * command and whose caret opens the label picker.
 *
 * Pure — `import type` only, so the unit tests never load the SDK runtime.
 */

import type {
  MenuEntry,
  ToolbarCommandItemContribution,
  ToolbarItemContext,
  ToolbarSurface,
} from "@silo-code/sdk";

/** Any shape this module emits for one surface. */
export type FollowUpToolbarItem<S extends ToolbarSurface> =
  ToolbarCommandItemContribution<S>;

/** Everything the contributions close over, so none of it is reached globally. */
export interface ToolbarDeps {
  /**
   * The command half's tooltip — "Mark as follow-up: Blocked". A plain
   * string, not a builder, which is the whole reason these items are
   * re-registered when the default label is renamed.
   */
  tooltip: string;
  editorMarked: (target: ToolbarItemContext["editor"]) => boolean;
  editorMenu: (target: ToolbarItemContext["editor"]) => MenuEntry[];
  /**
   * Whether this panel can carry a mark at all — false for a transient kind,
   * which has no `DockPanelRecord.id` to file one under.
   */
  panelAvailable: (target: ToolbarItemContext["panel"]) => boolean;
  panelMarked: (target: ToolbarItemContext["panel"]) => boolean;
  panelMenu: (target: ToolbarItemContext["panel"]) => MenuEntry[];
}

export const TOGGLE_COMMAND = "silo.follow-ups.toggle";
export const EDITOR_ITEM_ID = "silo.follow-ups.toolbar.editor";
export const PANEL_ITEM_ID = "silo.follow-ups.toolbar.panel";

/** The caret's own name. */
const OPTIONS_LABEL = "Follow-up options";

/**
 * Every toolbar contribution this extension makes, grouped by surface: one
 * welded item each, carrying a single `when`, `order`, and `checked` for the
 * whole control.
 */
export function buildToolbarItems(deps: ToolbarDeps): {
  editor: FollowUpToolbarItem<"editor">[];
  panel: FollowUpToolbarItem<"panel">[];
} {
  return {
    editor: [
      {
        id: EDITOR_ITEM_ID,
        surface: "editor",
        command: TOGGLE_COMMAND,
        icon: "Flag",
        label: "Follow-up",
        tooltip: deps.tooltip,
        order: 100,
        checked: (_k, t) => deps.editorMarked(t),
        dropdown: {
          menu: (t) => deps.editorMenu(t),
          label: OPTIONS_LABEL,
          tooltip: OPTIONS_LABEL,
        },
      },
    ],
    // RFC 0039: every dock panel's toolbar (terminal included) lives on the
    // host-drawn "panel" strip. Unscoped by `kindId` — a follow-up means the
    // same thing on every tab — but gated on the target resolving, which
    // excludes a panel kind that never opted into a persisted record and so
    // has no stable id to file a mark under.
    panel: [
      {
        id: PANEL_ITEM_ID,
        surface: "panel",
        command: TOGGLE_COMMAND,
        icon: "Flag",
        label: "Follow-up",
        tooltip: deps.tooltip,
        order: 100,
        when: (_k, t) => deps.panelAvailable(t),
        checked: (_k, t) => deps.panelMarked(t),
        dropdown: {
          menu: (t) => deps.panelMenu(t),
          label: OPTIONS_LABEL,
          tooltip: OPTIONS_LABEL,
        },
      },
    ],
  };
}
