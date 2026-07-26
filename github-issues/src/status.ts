import type { IssueListItem } from "./github-issue-api";

export type IssueState = "open" | "closed-completed" | "closed-not-planned";

// The row's primary at-a-glance signal. A closed issue without a stateReason
// (older data, or closed before GitHub tracked reasons) reads as "completed" —
// the more common case, and matches GitHub's own web UI fallback.
export function deriveIssueState(issue: IssueListItem): IssueState {
  if (issue.state === "OPEN") return "open";
  return issue.stateReason === "NOT_PLANNED" ? "closed-not-planned" : "closed-completed";
}

export const STATE_LABELS: Record<IssueState, string> = {
  open: "Open",
  "closed-completed": "Closed as completed",
  "closed-not-planned": "Closed as not planned",
};

export function offersClose(issue: IssueListItem): boolean {
  return issue.state === "OPEN";
}

export function offersReopen(issue: IssueListItem): boolean {
  return issue.state === "CLOSED";
}
