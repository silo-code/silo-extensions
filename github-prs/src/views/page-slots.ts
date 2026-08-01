// Pure rules for the panel's page slide (PrPanel) — kept separate from the
// component so the slot rules are unit-testable without rendering React.
// Modeled on the same full-panel-takeover pattern used by Silo's git-explorer.
import type { PanelView } from "../view-stack";

export type PageSlot = "current" | "parked-left" | "parked-right";

// The stack is linear (list → detail → commits → commit), so a page's slot is
// just its fixed depth compared to the current view's depth: equal is
// centered, shallower parks left (the "back" direction), deeper parks right.
const VIEW_DEPTH: Record<PanelView["kind"], number> = {
  list: 0,
  detail: 1,
  commits: 2,
  commit: 3,
};

function pageSlot(view: PanelView, pageDepth: number): PageSlot {
  const currentDepth = VIEW_DEPTH[view.kind];
  if (pageDepth === currentDepth) return "current";
  return pageDepth < currentDepth ? "parked-left" : "parked-right";
}

/** The list page is the shallowest: centered unless something has been
 * pushed on top of it, in which case it parks off-screen left (the "back"
 * direction) while the deeper page slides in from the right. */
export function listPageSlot(view: PanelView): PageSlot {
  return pageSlot(view, 0);
}

/** Mirror of `listPageSlot` one level deeper. */
export function detailPageSlot(view: PanelView): PageSlot {
  return pageSlot(view, 1);
}

/** The PR's commit list, pushed from the detail page. */
export function commitsPageSlot(view: PanelView): PageSlot {
  return pageSlot(view, 2);
}

/** One commit's message + changed files, pushed from the commits list. */
export function commitPageSlot(view: PanelView): PageSlot {
  return pageSlot(view, 3);
}
