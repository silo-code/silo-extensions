import { describe, it, expect } from "vitest";
import {
  buildTimeline,
  checkKey,
  findPrInRepoStates,
  folderRootName,
  reviewKindLabel,
  uniqueReviewers,
} from "./detail-helpers";
import type { PrDetail, PrListItem } from "./github-pr-api";

function pr(partial: Partial<PrListItem> = {}): PrListItem {
  return {
    number: 1,
    title: "Test",
    url: "https://github.com/o/r/pull/1",
    author: { login: "dave" },
    isDraft: false,
    state: "OPEN",
    reviewDecision: "",
    reviewRequests: [],
    latestReviews: [],
    statusCheckRollup: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    mergedAt: null,
    headRefName: "feat",
    baseRefName: "main",
    labels: [],
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    additions: 1,
    deletions: 0,
    ...partial,
  };
}

describe("reviewKindLabel", () => {
  it("maps known review states to readable labels", () => {
    expect(reviewKindLabel("APPROVED")).toBe("approved");
    expect(reviewKindLabel("CHANGES_REQUESTED")).toBe("requested changes");
    expect(reviewKindLabel("COMMENTED")).toBe("commented");
  });

  it("falls back for unknown states", () => {
    expect(reviewKindLabel("WEIRD_STATE")).toBe("weird state");
  });
});

describe("folderRootName", () => {
  it("returns the last path segment", () => {
    expect(folderRootName("/Users/dave/Projects/silo")).toBe("silo");
    expect(folderRootName("silo")).toBe("silo");
  });
});

describe("checkKey", () => {
  it("is stable for CheckRun and StatusContext", () => {
    expect(
      checkKey({
        __typename: "CheckRun",
        name: "build",
        detailsUrl: "https://x/1",
      }),
    ).toBe("CheckRun:build:https://x/1");
    expect(
      checkKey({
        __typename: "StatusContext",
        context: "ci/lint",
        targetUrl: "https://x/2",
      }),
    ).toBe("StatusContext:ci/lint:https://x/2");
  });
});

describe("uniqueReviewers", () => {
  it("keeps the latest review per login", () => {
    const item = pr({
      latestReviews: [
        { author: { login: "a" }, state: "COMMENTED", submittedAt: "2026-01-01T00:00:00Z", body: "" },
        { author: { login: "a" }, state: "APPROVED", submittedAt: "2026-01-02T00:00:00Z", body: "" },
        { author: { login: "b" }, state: "CHANGES_REQUESTED", submittedAt: "2026-01-01T12:00:00Z", body: "" },
      ],
    });
    const reviewers = uniqueReviewers(item);
    expect(reviewers).toHaveLength(2);
    expect(reviewers.find((r) => r.author?.login === "a")?.state).toBe("APPROVED");
  });

  it("prefers detail.reviews when present", () => {
    const item = pr({
      latestReviews: [
        { author: { login: "a" }, state: "COMMENTED", submittedAt: "2026-01-01T00:00:00Z", body: "" },
      ],
    });
    const detail = {
      ...item,
      body: "",
      changedFiles: 0,
      closedAt: null,
      comments: [],
      reviews: [
        { author: { login: "a" }, state: "APPROVED", submittedAt: "2026-01-03T00:00:00Z", body: "" },
      ],
    } as PrDetail;
    expect(uniqueReviewers(item, detail)[0]?.state).toBe("APPROVED");
  });
});

describe("buildTimeline", () => {
  it("merges comments and reviews, newest first", () => {
    const detail = {
      ...pr(),
      body: "",
      changedFiles: 0,
      closedAt: null,
      comments: [
        {
          author: { login: "dave" },
          body: "old",
          createdAt: "2026-01-01T00:00:00Z",
          url: "",
        },
      ],
      reviews: [
        {
          author: { login: "alice" },
          state: "APPROVED",
          submittedAt: "2026-01-02T00:00:00Z",
          body: "lgtm",
        },
      ],
    } as PrDetail;
    const items = buildTimeline(detail);
    expect(items[0]?.who).toBe("alice");
    expect(items[0]?.kindLabel).toBe("approved");
    expect(items[1]?.kindLabel).toBe("commented");
  });

  it("skips empty COMMENTED reviews", () => {
    const detail = {
      ...pr(),
      body: "",
      changedFiles: 0,
      closedAt: null,
      comments: [],
      reviews: [
        { author: { login: "a" }, state: "COMMENTED", submittedAt: "2026-01-01T00:00:00Z", body: "" },
      ],
    } as PrDetail;
    expect(buildTimeline(detail)).toEqual([]);
  });
});

describe("findPrInRepoStates", () => {
  it("finds a PR across open and merged lists", () => {
    const states = [
      { folder: "/a", openPrs: [pr({ number: 1 })], mergedPrs: [] },
      { folder: "/b", openPrs: [], mergedPrs: [pr({ number: 9, state: "MERGED" })] },
    ];
    expect(findPrInRepoStates(states, "/b", 9)?.number).toBe(9);
    expect(findPrInRepoStates(states, "/a", 99)).toBeNull();
  });
});
