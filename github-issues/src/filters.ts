import type { IssueListItem } from "./github-issue-api";

// Which issues the panel shows for a workspace. Filtering is client-side so
// switching filters is instant and the poll cost stays constant; only
// "closed" changes what gets fetched (a separate, on-demand list).
export type IssueFilter = "assigned" | "authored" | "all" | "closed";

export const DEFAULT_FILTER: IssueFilter = "assigned";

// Menu order.
export const ISSUE_FILTERS: IssueFilter[] = ["assigned", "authored", "all", "closed"];

export const FILTER_LABELS: Record<IssueFilter, string> = {
  assigned: "Assigned to me",
  authored: "Created by me",
  all: "All open",
  closed: "Recently closed",
};

function byUpdatedDesc(a: IssueListItem, b: IssueListItem): number {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

// The visible issues for one repo under a filter, newest-activity first. The
// viewer-scoped filters return empty until the viewer login is known — a brief
// startup state, preferable to flashing someone else's issues.
export function filterIssues(
  openIssues: IssueListItem[],
  closedIssues: IssueListItem[],
  filter: IssueFilter,
  viewerLogin: string | null,
): IssueListItem[] {
  let out: IssueListItem[];
  switch (filter) {
    case "all":
      out = [...openIssues];
      break;
    case "closed":
      out = [...closedIssues];
      break;
    case "assigned":
      out = viewerLogin
        ? openIssues.filter((i) => i.assignees.some((a) => a.login === viewerLogin))
        : [];
      break;
    case "authored":
      out = viewerLogin ? openIssues.filter((i) => i.author?.login === viewerLogin) : [];
      break;
  }
  return out.sort(byUpdatedDesc);
}
