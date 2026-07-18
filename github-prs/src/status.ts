import type { CheckContext, PrListItem } from "./github-pr-api";

// ─── CI checks ────────────────────────────────────────────────────────────────

export type CheckOutcome = "passing" | "failing" | "pending";

// A CheckRun that isn't COMPLETED is still running; a completed one maps by
// conclusion. NEUTRAL and SKIPPED count as passing — they don't block a merge.
// A StatusContext (commit status) maps by state.
export function classifyCheck(check: CheckContext): CheckOutcome {
  if (check.__typename === "CheckRun") {
    if (check.status !== "COMPLETED") return "pending";
    switch (check.conclusion) {
      case "SUCCESS":
      case "NEUTRAL":
      case "SKIPPED":
        return "passing";
      default:
        return "failing";
    }
  }
  switch (check.state) {
    case "SUCCESS":
      return "passing";
    case "PENDING":
    case "EXPECTED":
      return "pending";
    default:
      return "failing";
  }
}

export interface CheckSummary {
  passing: number;
  failing: number;
  pending: number;
  total: number;
  overall: CheckOutcome | "none";
}

// Overall severity: any failure trumps pending trumps passing — the row glyph
// shows the worst outcome so a red mark always means something needs attention.
export function summarizeChecks(rollup: CheckContext[]): CheckSummary {
  const summary: CheckSummary = { passing: 0, failing: 0, pending: 0, total: rollup.length, overall: "none" };
  for (const check of rollup) {
    summary[classifyCheck(check)]++;
  }
  if (summary.failing > 0) summary.overall = "failing";
  else if (summary.pending > 0) summary.overall = "pending";
  else if (summary.passing > 0) summary.overall = "passing";
  return summary;
}

// Tooltip text for the row's checks glyph, e.g. "3 passing · 1 failing".
export function checkSummaryLabel(summary: CheckSummary): string {
  if (summary.total === 0) return "No checks";
  const parts: string[] = [];
  if (summary.passing > 0) parts.push(`${summary.passing} passing`);
  if (summary.failing > 0) parts.push(`${summary.failing} failing`);
  if (summary.pending > 0) parts.push(`${summary.pending} pending`);
  return parts.join(" · ");
}

export function checkName(check: CheckContext): string {
  return check.__typename === "CheckRun" ? check.name : check.context;
}

export function checkUrl(check: CheckContext): string {
  return check.__typename === "CheckRun" ? check.detailsUrl : check.targetUrl;
}

// ─── Review state ─────────────────────────────────────────────────────────────

export type ReviewState =
  | "merged"
  | "closed"
  | "draft"
  | "approved"
  | "changes-requested"
  | "review-required"
  | "none";

// The row's primary at-a-glance signal. Lifecycle states (merged/closed/draft)
// win over the review decision — an approved draft still isn't reviewable.
export function deriveReviewState(pr: PrListItem): ReviewState {
  if (pr.state === "MERGED") return "merged";
  if (pr.state === "CLOSED") return "closed";
  if (pr.isDraft) return "draft";
  switch (pr.reviewDecision) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes-requested";
    case "REVIEW_REQUIRED":
      return "review-required";
    default:
      return "none"; // no required reviewers configured
  }
}

export const REVIEW_STATE_LABELS: Record<ReviewState, string> = {
  merged: "Merged",
  closed: "Closed",
  draft: "Draft",
  approved: "Approved",
  "changes-requested": "Changes requested",
  "review-required": "Review required",
  none: "Open",
};

export function hasConflicts(pr: PrListItem): boolean {
  return pr.mergeable === "CONFLICTING";
}

// Merge is offered for every PR that is not already merged (including closed /
// draft / blocked); enabled only when merge-ready.
export function offersMerge(pr: PrListItem): boolean {
  return pr.state !== "MERGED";
}

// Open, not draft, and GitHub's full merge gate is CLEAN — not merely
// conflict-free (`mergeable === MERGEABLE`).
export function isMergeReady(pr: PrListItem): boolean {
  return pr.state === "OPEN" && !pr.isDraft && pr.mergeStateStatus === "CLEAN";
}

// Short tooltip copy for a disabled Merge button. Null when merge-ready (no
// tooltip needed) or when Merge is not offered.
export function mergeBlockReason(pr: PrListItem): string | null {
  if (!offersMerge(pr)) return null;
  if (isMergeReady(pr)) return null;
  if (pr.state === "CLOSED") return "Closed pull requests can't be merged";
  if (pr.isDraft) return "Draft pull requests can't be merged";
  if (pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY") {
    return "This branch has conflicts that must be resolved";
  }
  switch (pr.mergeStateStatus) {
    case "BLOCKED":
      return "Merge is blocked by required checks or reviews";
    case "BEHIND":
      return "Branch is out of date with the base branch";
    case "UNSTABLE":
      return "Required checks are failing or incomplete";
    case "UNKNOWN":
      return "Merge status is still computing — try Refresh";
    default:
      if (pr.mergeable === "UNKNOWN") {
        return "Merge status is still computing — try Refresh";
      }
      return "This pull request isn't ready to merge";
  }
}
