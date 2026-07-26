// Pure rules for the panel's list/detail slide (IssuePanel) — kept separate
// from the component so the slot rules are unit-testable without rendering
// React. Modeled on the same full-panel-takeover pattern used by Silo's
// git-explorer.
import type { PanelView } from "../view-stack";

export type PageSlot = "current" | "parked-left" | "parked-right";

/** The list page is the shallow one: centered unless a detail has been pushed
 * on top of it, in which case it parks off-screen left (the "back" direction)
 * while detail slides in from the right. */
export function listPageSlot(view: PanelView): PageSlot {
  return view.kind === "detail" ? "parked-left" : "current";
}

/** Mirror of `listPageSlot`: detail is centered only while it's the current
 * view; otherwise it parks off-screen right, ready to slide back in. */
export function detailPageSlot(view: PanelView): PageSlot {
  return view.kind === "detail" ? "current" : "parked-right";
}
