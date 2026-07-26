import { describe, it, expect } from "vitest";
import { deriveIssueState, offersClose, offersReopen, STATE_LABELS } from "./status";
import type { IssueListItem } from "./github-issue-api";

function issue(partial: Partial<IssueListItem>): IssueListItem {
  return {
    number: 1,
    title: "An issue",
    url: "https://github.com/o/r/issues/1",
    author: { login: "someone" },
    state: "OPEN",
    stateReason: null,
    labels: [],
    assignees: [],
    milestone: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    closedAt: null,
    ...partial,
  };
}

describe("deriveIssueState", () => {
  it("is open for OPEN issues", () => {
    expect(deriveIssueState(issue({ state: "OPEN" }))).toBe("open");
  });

  it("distinguishes completed from not-planned closures", () => {
    expect(deriveIssueState(issue({ state: "CLOSED", stateReason: "COMPLETED" }))).toBe("closed-completed");
    expect(deriveIssueState(issue({ state: "CLOSED", stateReason: "NOT_PLANNED" }))).toBe("closed-not-planned");
  });

  it("treats a missing stateReason on a closed issue as completed", () => {
    expect(deriveIssueState(issue({ state: "CLOSED", stateReason: null }))).toBe("closed-completed");
  });

  it("has a label for every state", () => {
    expect(STATE_LABELS.open).toBeTruthy();
    expect(STATE_LABELS["closed-completed"]).toBeTruthy();
    expect(STATE_LABELS["closed-not-planned"]).toBeTruthy();
  });
});

describe("offersClose / offersReopen", () => {
  it("offers Close only for open issues", () => {
    expect(offersClose(issue({ state: "OPEN" }))).toBe(true);
    expect(offersClose(issue({ state: "CLOSED" }))).toBe(false);
  });

  it("offers Reopen only for closed issues", () => {
    expect(offersReopen(issue({ state: "CLOSED" }))).toBe(true);
    expect(offersReopen(issue({ state: "OPEN" }))).toBe(false);
  });
});
