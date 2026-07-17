import { describe, it, expect } from "vitest";
import { filterPrs, DEFAULT_FILTER, FILTER_LABELS, PR_FILTERS } from "./filters";
import type { PrListItem } from "./github-pr-api";

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

const MINE = pr({ number: 1, author: { login: "dave" }, updatedAt: "2026-01-02T00:00:00Z" });
const THEIRS = pr({ number: 2, author: { login: "alice" }, updatedAt: "2026-01-03T00:00:00Z" });
const WANTS_MY_REVIEW = pr({
  number: 3,
  author: { login: "alice" },
  reviewRequests: [{ login: "dave", name: null }],
  updatedAt: "2026-01-01T00:00:00Z",
});
const TEAM_REQUEST = pr({
  number: 4,
  author: { login: "alice" },
  reviewRequests: [{ login: null, name: "core-team" }],
});
const OPEN = [MINE, THEIRS, WANTS_MY_REVIEW, TEAM_REQUEST];
const MERGED = [pr({ number: 9, state: "MERGED", author: { login: "dave" } })];

describe("filterPrs", () => {
  it("defaults to the authored filter", () => {
    expect(DEFAULT_FILTER).toBe("authored");
  });

  it("authored keeps only the viewer's PRs", () => {
    expect(filterPrs(OPEN, MERGED, "authored", "dave").map((p) => p.number)).toEqual([1]);
  });

  it("review-requested matches direct user requests only, not team requests", () => {
    expect(filterPrs(OPEN, MERGED, "review-requested", "dave").map((p) => p.number)).toEqual([3]);
  });

  it("all returns every open PR sorted by latest activity", () => {
    expect(filterPrs(OPEN, MERGED, "all", "dave").map((p) => p.number)).toEqual([2, 1, 3, 4]);
  });

  it("merged draws from the merged list regardless of author", () => {
    expect(filterPrs(OPEN, MERGED, "merged", "dave").map((p) => p.number)).toEqual([9]);
  });

  it("viewer-scoped filters return empty until the login is known", () => {
    expect(filterPrs(OPEN, MERGED, "authored", null)).toEqual([]);
    expect(filterPrs(OPEN, MERGED, "review-requested", null)).toEqual([]);
    expect(filterPrs(OPEN, MERGED, "all", null)).toHaveLength(4);
  });

  it("handles empty inputs", () => {
    expect(filterPrs([], [], "all", "dave")).toEqual([]);
    expect(filterPrs([], [], "merged", "dave")).toEqual([]);
  });

  it("authored matching is case-sensitive on login", () => {
    expect(filterPrs(OPEN, MERGED, "authored", "Dave").map((p) => p.number)).toEqual([]);
    expect(filterPrs(OPEN, MERGED, "authored", "dave").map((p) => p.number)).toEqual([1]);
  });

  it("has a label for every filter", () => {
    for (const f of PR_FILTERS) {
      expect(FILTER_LABELS[f]).toBeTruthy();
    }
  });
});
