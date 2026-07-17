import { describe, it, expect } from "vitest";
import {
  classifyCheck,
  summarizeChecks,
  checkSummaryLabel,
  checkName,
  checkUrl,
  deriveReviewState,
  hasConflicts,
} from "./status";
import type { CheckContext, PrListItem } from "./github-pr-api";

function checkRun(partial: Partial<Extract<CheckContext, { __typename: "CheckRun" }>>): CheckContext {
  return {
    __typename: "CheckRun",
    name: "build",
    status: "COMPLETED",
    conclusion: "SUCCESS",
    detailsUrl: "https://github.com/o/r/actions/runs/1",
    workflowName: "CI",
    startedAt: "2026-01-01T00:00:00Z",
    completedAt: "2026-01-01T00:01:00Z",
    ...partial,
  };
}

function statusContext(partial: Partial<Extract<CheckContext, { __typename: "StatusContext" }>>): CheckContext {
  return {
    __typename: "StatusContext",
    context: "ci/lint",
    state: "SUCCESS",
    targetUrl: "https://example.com/status/1",
    ...partial,
  };
}

function pr(partial: Partial<PrListItem>): PrListItem {
  return {
    number: 1,
    title: "A PR",
    url: "https://github.com/o/r/pull/1",
    author: { login: "someone" },
    isDraft: false,
    state: "OPEN",
    reviewDecision: "",
    reviewRequests: [],
    latestReviews: [],
    statusCheckRollup: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    mergedAt: null,
    headRefName: "feat/x",
    baseRefName: "main",
    labels: [],
    mergeable: "UNKNOWN",
    mergeStateStatus: "UNKNOWN",
    additions: 0,
    deletions: 0,
    ...partial,
  };
}

describe("classifyCheck", () => {
  it("classifies a completed CheckRun by conclusion", () => {
    expect(classifyCheck(checkRun({ conclusion: "SUCCESS" }))).toBe("passing");
    expect(classifyCheck(checkRun({ conclusion: "NEUTRAL" }))).toBe("passing");
    expect(classifyCheck(checkRun({ conclusion: "SKIPPED" }))).toBe("passing");
    expect(classifyCheck(checkRun({ conclusion: "FAILURE" }))).toBe("failing");
    expect(classifyCheck(checkRun({ conclusion: "CANCELLED" }))).toBe("failing");
  });

  it("treats an in-progress CheckRun as pending regardless of conclusion", () => {
    expect(classifyCheck(checkRun({ status: "IN_PROGRESS", conclusion: "" }))).toBe("pending");
    expect(classifyCheck(checkRun({ status: "QUEUED", conclusion: "" }))).toBe("pending");
  });

  it("classifies a StatusContext by state", () => {
    expect(classifyCheck(statusContext({ state: "SUCCESS" }))).toBe("passing");
    expect(classifyCheck(statusContext({ state: "PENDING" }))).toBe("pending");
    expect(classifyCheck(statusContext({ state: "EXPECTED" }))).toBe("pending");
    expect(classifyCheck(statusContext({ state: "FAILURE" }))).toBe("failing");
    expect(classifyCheck(statusContext({ state: "ERROR" }))).toBe("failing");
  });
});

describe("summarizeChecks", () => {
  it("returns 'none' overall for an empty rollup", () => {
    const summary = summarizeChecks([]);
    expect(summary).toEqual({ passing: 0, failing: 0, pending: 0, total: 0, overall: "none" });
  });

  it("overall is failing if any check fails, even with mixed pending/passing", () => {
    const summary = summarizeChecks([
      checkRun({ conclusion: "SUCCESS" }),
      checkRun({ status: "IN_PROGRESS", conclusion: "" }),
      statusContext({ state: "FAILURE" }),
    ]);
    expect(summary).toEqual({ passing: 1, failing: 1, pending: 1, total: 3, overall: "failing" });
  });

  it("overall is pending when nothing fails but something is in flight", () => {
    const summary = summarizeChecks([checkRun({ conclusion: "SUCCESS" }), checkRun({ status: "QUEUED", conclusion: "" })]);
    expect(summary.overall).toBe("pending");
  });

  it("overall is passing when everything succeeded", () => {
    expect(summarizeChecks([checkRun({}), statusContext({ state: "SUCCESS" })]).overall).toBe("passing");
  });
});

describe("checkSummaryLabel", () => {
  it("reports no checks for an empty rollup", () => {
    expect(checkSummaryLabel(summarizeChecks([]))).toBe("No checks");
  });

  it("joins non-zero counts", () => {
    const summary = summarizeChecks([
      checkRun({ conclusion: "SUCCESS" }),
      checkRun({ conclusion: "SUCCESS" }),
      statusContext({ state: "FAILURE" }),
    ]);
    expect(checkSummaryLabel(summary)).toBe("2 passing · 1 failing");
  });
});

describe("checkName / checkUrl", () => {
  it("reads name/detailsUrl from a CheckRun", () => {
    const c = checkRun({ name: "typecheck", detailsUrl: "https://x/run" });
    expect(checkName(c)).toBe("typecheck");
    expect(checkUrl(c)).toBe("https://x/run");
  });

  it("reads context/targetUrl from a StatusContext", () => {
    const c = statusContext({ context: "ci/lint", targetUrl: "https://x/status" });
    expect(checkName(c)).toBe("ci/lint");
    expect(checkUrl(c)).toBe("https://x/status");
  });
});

describe("deriveReviewState", () => {
  it("lifecycle states win over review decision", () => {
    expect(deriveReviewState(pr({ state: "MERGED", reviewDecision: "APPROVED" }))).toBe("merged");
    expect(deriveReviewState(pr({ state: "CLOSED", reviewDecision: "APPROVED" }))).toBe("closed");
    expect(deriveReviewState(pr({ isDraft: true, reviewDecision: "APPROVED" }))).toBe("draft");
  });

  it("maps each reviewDecision value", () => {
    expect(deriveReviewState(pr({ reviewDecision: "APPROVED" }))).toBe("approved");
    expect(deriveReviewState(pr({ reviewDecision: "CHANGES_REQUESTED" }))).toBe("changes-requested");
    expect(deriveReviewState(pr({ reviewDecision: "REVIEW_REQUIRED" }))).toBe("review-required");
    expect(deriveReviewState(pr({ reviewDecision: "" }))).toBe("none");
  });

  it("treats unknown reviewDecision as none", () => {
    expect(deriveReviewState(pr({ reviewDecision: "SOMETHING_NEW" as PrListItem["reviewDecision"] }))).toBe("none");
  });
});

describe("hasConflicts", () => {
  it("is true only when mergeable is CONFLICTING", () => {
    expect(hasConflicts(pr({ mergeable: "CONFLICTING" }))).toBe(true);
    expect(hasConflicts(pr({ mergeable: "MERGEABLE" }))).toBe(false);
    expect(hasConflicts(pr({ mergeable: "UNKNOWN" }))).toBe(false);
  });
});
