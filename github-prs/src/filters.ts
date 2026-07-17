import type { PrListItem } from "./github-pr-api";

// Which PRs the panel shows for a workspace. Filtering is client-side so
// switching filters is instant and the poll cost stays constant; only
// "merged" changes what gets fetched (a separate, on-demand list).
export type PrFilter = "all" | "authored" | "review-requested" | "merged";

export const DEFAULT_FILTER: PrFilter = "authored";

// Menu / property-page order.
export const PR_FILTERS: PrFilter[] = ["authored", "review-requested", "all", "merged"];

export const FILTER_LABELS: Record<PrFilter, string> = {
  authored: "My PRs",
  "review-requested": "Needs my review",
  all: "All open",
  merged: "Recently merged",
};

function byUpdatedDesc(a: PrListItem, b: PrListItem): number {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

// The visible PRs for one repo under a filter, newest-activity first. The
// viewer-scoped filters return empty until the viewer login is known — a brief
// startup state, preferable to flashing someone else's PRs.
export function filterPrs(
  openPrs: PrListItem[],
  mergedPrs: PrListItem[],
  filter: PrFilter,
  viewerLogin: string | null,
): PrListItem[] {
  let out: PrListItem[];
  switch (filter) {
    case "all":
      out = [...openPrs];
      break;
    case "merged":
      out = [...mergedPrs];
      break;
    case "authored":
      out = viewerLogin ? openPrs.filter((p) => p.author?.login === viewerLogin) : [];
      break;
    case "review-requested":
      // Matches direct user requests only; a request routed to a team the
      // viewer belongs to can't be resolved from the PR payload alone.
      out = viewerLogin
        ? openPrs.filter((p) => p.reviewRequests.some((r) => r.login === viewerLogin))
        : [];
      break;
  }
  return out.sort(byUpdatedDesc);
}
