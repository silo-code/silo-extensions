// Pure rules for the panel's page slide (PrPanel) — kept separate from the
// component so the slot rules are unit-testable without rendering React.
// Modeled on the same full-panel-takeover pattern used by Silo's git-explorer.
import type { PanelView } from "../view-stack";

export type PageSlot = "current" | "parked-left" | "parked-right";

// The stack is linear (list → detail → {commits → commit, files, review})
// with one exception: "commits", "files", and "review" are *siblings*, all
// reached directly from detail, so they share depth 2. "Current" is decided
// by exact kind match (not depth equality) precisely because of that — with
// depth alone, viewing "commits" would also compute "current" for "files"
// and "review" (same depth), putting multiple pages at translateX(0)
// simultaneously. Depth only decides which side a non-current page parks on.
const VIEW_DEPTH: Record<PanelView["kind"], number> = {
  list: 0,
  detail: 1,
  commits: 2,
  files: 2,
  review: 2,
  commit: 3,
};

function pageSlot(view: PanelView, pageKind: PanelView["kind"]): PageSlot {
  if (view.kind === pageKind) return "current";
  return VIEW_DEPTH[pageKind] < VIEW_DEPTH[view.kind] ? "parked-left" : "parked-right";
}

/** The list page is the shallowest: centered unless something has been
 * pushed on top of it, in which case it parks off-screen left (the "back"
 * direction) while the deeper page slides in from the right. */
export function listPageSlot(view: PanelView): PageSlot {
  return pageSlot(view, "list");
}

/** Mirror of `listPageSlot` one level deeper. */
export function detailPageSlot(view: PanelView): PageSlot {
  return pageSlot(view, "detail");
}

/** The PR's commit list, pushed from the detail page. */
export function commitsPageSlot(view: PanelView): PageSlot {
  return pageSlot(view, "commits");
}

/** One commit's message + changed files, pushed from the commits list. */
export function commitPageSlot(view: PanelView): PageSlot {
  return pageSlot(view, "commit");
}

/** The PR's overall changed files, pushed from the detail page (a sibling
 * of "commits" — see the VIEW_DEPTH comment above). */
export function filesPageSlot(view: PanelView): PageSlot {
  return pageSlot(view, "files");
}

/** One review's full body, pushed from a review row on the detail page
 * (another sibling of "commits" — see the VIEW_DEPTH comment above). */
export function reviewPageSlot(view: PanelView): PageSlot {
  return pageSlot(view, "review");
}
