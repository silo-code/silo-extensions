/**
 * Which flagged tab, if any, is the one the user is looking at right now.
 *
 * There is exactly one active center-dock tab in the app, so at most one row
 * in the whole view is current — it has to be in the active workspace, and it
 * has to be that workspace's active tab.
 *
 * Pure — `import type` only. The reading of the three live signals lives in
 * `ui/FollowUpsView.tsx`; this is just the rule.
 */

import type { FollowUpItem } from "./view";

/** A snapshot of what the app currently has focused. */
export interface ActiveTabRef {
  /** `ctx.workspaces.getState().activeId`. */
  workspaceId: string | null;
  /**
   * `ctx.editors.getState().active?.editorId` — `null` whenever the active
   * dock panel is not an editor tab.
   */
  editorId: string | null;
  /** `ctx.terminals.getState()` — `null` when the active panel is not a terminal. */
  terminalId: string | null;
  /**
   * `ctx.panels.getState()?.recordId` — the `DockPanelRecord.id` of the active
   * dock panel. `null` when an editor or a terminal is active instead, or when
   * the active panel is a transient kind with no record to name.
   */
  panelRecordId: string | null;
}

export const NO_ACTIVE_TAB: ActiveTabRef = {
  workspaceId: null,
  editorId: null,
  terminalId: null,
  panelRecordId: null,
};

/**
 * Whether this row *is* the tab currently on screen.
 *
 * All three kinds are answerable from `ctx.panels`'s active-panel state. The
 * host guarantees it reports `null` whenever an editor
 * or a terminal is active, so there is no state in which an active editor
 * reads as an active panel — which is what lets this compare directly instead
 * of inferring "neither an editor nor a terminal is active, so it must be this
 * panel", a guess that would light up every flagged panel row in the workspace
 * at once.
 */
export function isCurrent(item: FollowUpItem, active: ActiveTabRef): boolean {
  if (active.workspaceId === null || item.workspaceId !== active.workspaceId) {
    return false;
  }
  if (item.kind === "editor") return item.id === active.editorId;
  if (item.kind === "terminal") return item.id === active.terminalId;
  // Both sides are `DockPanelRecord.id`: `FollowUpItem.id` is the persisted
  // key, and `ActivePanelInfo.recordId` is the same id the host reports for a
  // recorded kind. A transient panel has neither, so it can't be flagged and
  // can't match.
  return active.panelRecordId !== null && item.id === active.panelRecordId;
}
