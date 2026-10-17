/**
 * The follow-up dropdown and the Navigator's group-by menu, as pure builders.
 *
 * Both chromes render these: the caret toolbar item beside the Flag on the
 * editor and panel strips, and the hover `⋯` on a Navigator row. One
 * definition, so the two surfaces cannot drift.
 *
 * No React and no `ctx` — a `MenuEntry` is data. The one thing a `MenuItem`
 * can carry that *is* React is its `icon`, so the colored swatch arrives as an
 * injected factory rather than a JSX import here (which would pull the SDK
 * runtime into these tests).
 */

import type { MenuEntry, MenuItem } from "@silo-code/sdk";
import type { FollowUpLabel, LabelId } from "./labels";
import type { FollowUp } from "./store";
import {
  GROUP_BY_LABELS,
  GROUP_BY_VALUES,
  type FollowUpGroupBy,
} from "./view";

/** What the dropdown's rows do. Supplied by whichever surface opened it. */
export interface FollowUpActions {
  /** Mark with (or re-label to) this label. */
  setLabel(labelId: LabelId): void;
  /** Open the note modal — for both "Add note…" and "Edit note…". */
  editNote(): void;
  /** Clear the note, keeping the follow-up. */
  removeNote(): void;
  /** Clear the follow-up entirely. */
  clear(): void;
}

/** Renders a label's color swatch for a row's leading gutter. */
export type SwatchFactory = (labelId: LabelId) => MenuItem["icon"];

/**
 * The follow-up dropdown: pick a label, manage the note, clear.
 *
 * `current` is `null` when the tab isn't marked — the label rows then *mark*
 * rather than re-label, nothing is checked, and the note rows are absent
 * (there is no follow-up to hang a note on yet).
 */
export function followUpMenu(
  labels: readonly FollowUpLabel[],
  current: FollowUp | null,
  actions: FollowUpActions,
  swatch?: SwatchFactory,
): MenuEntry[] {
  const entries: MenuEntry[] = [{ type: "header", label: "Follow up with" }];
  for (const label of labels) {
    entries.push({
      label: label.name,
      checked: current?.labelId === label.id,
      icon: swatch?.(label.id),
      run: () => actions.setLabel(label.id),
    });
  }

  const note = current?.note ?? "";
  if (current) {
    entries.push({ type: "separator" });
    entries.push({
      label: note === "" ? "Add note…" : "Edit note…",
      run: () => actions.editNote(),
    });
    if (note !== "") {
      entries.push({ label: "Remove note", run: () => actions.removeNote() });
    }
  }

  entries.push({ type: "separator" });
  entries.push({
    label: "Clear follow-up",
    // Shown-but-disabled rather than hidden: the row's position in the menu
    // stays put whether or not the tab is marked.
    disabled: current === null,
    run: () => actions.clear(),
  });
  return entries;
}

/** The Navigator view's group-by dropdown. */
export function groupMenu(
  groupBy: FollowUpGroupBy,
  apply: (next: FollowUpGroupBy) => void,
): MenuEntry[] {
  const entries: MenuEntry[] = [{ type: "header", label: "Group by" }];
  for (const value of GROUP_BY_VALUES) {
    entries.push({
      label: GROUP_BY_LABELS[value],
      checked: groupBy === value,
      run: () => apply(value),
    });
  }
  return entries;
}
