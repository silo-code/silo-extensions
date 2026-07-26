import { describe, it, expect } from "vitest";
import {
  buildTimeline,
  findIssueInRepoStates,
  folderRootName,
  labelTextColor,
} from "./detail-helpers";
import type { IssueDetail, IssueListItem } from "./github-issue-api";

function issue(partial: Partial<IssueListItem> = {}): IssueListItem {
  return {
    number: 1,
    title: "Test",
    url: "https://github.com/o/r/issues/1",
    author: { login: "dave" },
    state: "OPEN",
    stateReason: null,
    labels: [],
    assignees: [],
    milestone: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    closedAt: null,
    ...partial,
  };
}

describe("folderRootName", () => {
  it("returns the last path segment", () => {
    expect(folderRootName("/Users/dave/Projects/silo")).toBe("silo");
    expect(folderRootName("silo")).toBe("silo");
  });
});

describe("buildTimeline", () => {
  it("returns comments newest first", () => {
    const detail: IssueDetail = {
      ...issue(),
      body: "",
      comments: [
        { author: { login: "dave" }, body: "old", createdAt: "2026-01-01T00:00:00Z", url: "" },
        { author: { login: "alice" }, body: "new", createdAt: "2026-01-02T00:00:00Z", url: "" },
      ],
    };
    const items = buildTimeline(detail);
    expect(items[0]?.who).toBe("alice");
    expect(items[1]?.who).toBe("dave");
  });

  it("returns an empty timeline with no comments", () => {
    const detail: IssueDetail = { ...issue(), body: "", comments: [] };
    expect(buildTimeline(detail)).toEqual([]);
  });
});

describe("findIssueInRepoStates", () => {
  it("finds an issue across open and closed lists by repoKey", () => {
    const states = [
      { repoInfo: { owner: "o", repo: "a" }, openIssues: [issue({ number: 1 })], closedIssues: [] },
      { repoInfo: { owner: "o", repo: "b" }, openIssues: [], closedIssues: [issue({ number: 9, state: "CLOSED" })] },
    ];
    expect(findIssueInRepoStates(states, "o/b", 9)?.number).toBe(9);
    expect(findIssueInRepoStates(states, "o/a", 99)).toBeNull();
  });
});

describe("labelTextColor", () => {
  it("picks black text on light backgrounds", () => {
    expect(labelTextColor("ffffff")).toBe("#000000");
    expect(labelTextColor("#d4c5f9")).toBe("#000000");
  });

  it("picks white text on dark backgrounds", () => {
    expect(labelTextColor("000000")).toBe("#ffffff");
    expect(labelTextColor("#0e8a16")).toBe("#ffffff");
  });

  it("falls back to black for a malformed hex value", () => {
    expect(labelTextColor("not-a-color")).toBe("#000000");
  });
});
