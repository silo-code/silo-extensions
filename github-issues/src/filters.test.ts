import { describe, it, expect } from "vitest";
import { filterIssues, DEFAULT_FILTER, FILTER_LABELS, ISSUE_FILTERS } from "./filters";
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

const MINE_AUTHORED = issue({ number: 1, author: { login: "dave" }, updatedAt: "2026-01-02T00:00:00Z" });
const THEIRS = issue({ number: 2, author: { login: "alice" }, updatedAt: "2026-01-03T00:00:00Z" });
const ASSIGNED_TO_ME = issue({
  number: 3,
  author: { login: "alice" },
  assignees: [{ login: "dave" }],
  updatedAt: "2026-01-01T00:00:00Z",
});
const OPEN = [MINE_AUTHORED, THEIRS, ASSIGNED_TO_ME];
const CLOSED = [issue({ number: 9, state: "CLOSED", stateReason: "COMPLETED", author: { login: "dave" } })];

describe("filterIssues", () => {
  it("defaults to the assigned filter", () => {
    expect(DEFAULT_FILTER).toBe("assigned");
  });

  it("assigned keeps only issues assigned to the viewer", () => {
    expect(filterIssues(OPEN, CLOSED, "assigned", "dave").map((i) => i.number)).toEqual([3]);
  });

  it("authored keeps only the viewer's issues", () => {
    expect(filterIssues(OPEN, CLOSED, "authored", "dave").map((i) => i.number)).toEqual([1]);
  });

  it("all returns every open issue sorted by latest activity", () => {
    expect(filterIssues(OPEN, CLOSED, "all", "dave").map((i) => i.number)).toEqual([2, 1, 3]);
  });

  it("closed draws from the closed list regardless of author", () => {
    expect(filterIssues(OPEN, CLOSED, "closed", "dave").map((i) => i.number)).toEqual([9]);
  });

  it("viewer-scoped filters return empty until the login is known", () => {
    expect(filterIssues(OPEN, CLOSED, "assigned", null)).toEqual([]);
    expect(filterIssues(OPEN, CLOSED, "authored", null)).toEqual([]);
    expect(filterIssues(OPEN, CLOSED, "all", null)).toHaveLength(3);
  });

  it("handles empty inputs", () => {
    expect(filterIssues([], [], "all", "dave")).toEqual([]);
    expect(filterIssues([], [], "closed", "dave")).toEqual([]);
  });

  it("assignee matching is case-sensitive on login", () => {
    expect(filterIssues(OPEN, CLOSED, "assigned", "Dave").map((i) => i.number)).toEqual([]);
    expect(filterIssues(OPEN, CLOSED, "assigned", "dave").map((i) => i.number)).toEqual([3]);
  });

  it("has a label for every filter", () => {
    for (const f of ISSUE_FILTERS) {
      expect(FILTER_LABELS[f]).toBeTruthy();
    }
  });
});
