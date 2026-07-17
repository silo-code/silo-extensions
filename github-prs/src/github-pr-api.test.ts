import { describe, it, expect } from "vitest";
import { classifyFetchError, normalizePrItem, normalizePrDetail } from "./github-pr-api";

describe("classifyFetchError", () => {
  it("classifies auth failures", () => {
    expect(classifyFetchError("HTTP 401: Bad credentials").kind).toBe("unauthenticated");
    expect(classifyFetchError("HTTP 403: Forbidden").kind).toBe("unauthenticated");
    expect(classifyFetchError("authentication required").kind).toBe("unauthenticated");
    expect(classifyFetchError("You are not logged into any GitHub hosts").kind).toBe("unauthenticated");
  });

  it("prefers unauthenticated over rate-limited when both appear", () => {
    // Re-auth is the actionable fix, so it wins the classification ladder.
    expect(classifyFetchError("HTTP 403: rate limit exceeded").kind).toBe("unauthenticated");
  });

  it("classifies not-found", () => {
    expect(classifyFetchError("HTTP 404: Not Found").kind).toBe("not-found");
    expect(classifyFetchError("GraphQL: Could not resolve to a Repository with the name 'x/y'. (repository)").kind).toBe("not-found");
  });

  it("classifies rate limiting", () => {
    expect(classifyFetchError("HTTP 429: too many requests").kind).toBe("rate-limited");
    expect(classifyFetchError("API rate limit exceeded").kind).toBe("rate-limited");
  });

  it("falls back to network with the stderr text", () => {
    const err = classifyFetchError("dial tcp: lookup api.github.com: no such host");
    expect(err.kind).toBe("network");
    expect(err.message).toContain("api.github.com");
  });

  it("provides a generic message for empty stderr", () => {
    const err = classifyFetchError("");
    expect(err.kind).toBe("network");
    expect(err.message).toBe("gh call failed");
  });
});

// Captured from a real `gh pr list --json …` invocation (trimmed).
const OPEN_PR_FIXTURE = JSON.parse(`{
  "additions": 35,
  "author": { "id": "MDQ6VXNlcjczNzMwOQ==", "is_bot": false, "login": "davideweaver", "name": "Dave Weaver" },
  "baseRefName": "main",
  "createdAt": "2026-07-17T02:34:03Z",
  "deletions": 1,
  "headRefName": "feat/rfc-0015-polling-gate-suppression",
  "isDraft": false,
  "labels": [{ "id": "L1", "name": "minor", "color": "d73a4a" }],
  "latestReviews": [{ "author": { "login": "reviewer1" }, "state": "APPROVED", "submittedAt": "2026-07-17T02:35:00Z" }],
  "mergeStateStatus": "UNKNOWN",
  "mergeable": "UNKNOWN",
  "number": 53,
  "reviewDecision": "",
  "reviewRequests": [{ "__typename": "User", "login": "reviewer2" }, { "__typename": "Team", "name": "core", "slug": "core-team" }],
  "statusCheckRollup": [
    {
      "__typename": "CheckRun",
      "completedAt": "2026-07-17T02:34:24Z",
      "conclusion": "SUCCESS",
      "detailsUrl": "https://github.com/silo-code/silo-extensions/actions/runs/1/job/2",
      "name": "docs-panel — typecheck & build",
      "startedAt": "2026-07-17T02:34:08Z",
      "status": "COMPLETED",
      "workflowName": "CI"
    },
    {
      "__typename": "StatusContext",
      "context": "ci/lint",
      "state": "PENDING",
      "targetUrl": "https://example.com/status/1"
    }
  ],
  "title": "feat(github-actions): gate polling",
  "updatedAt": "2026-07-17T02:37:00Z",
  "url": "https://github.com/silo-code/silo-extensions/pull/53"
}`);

describe("normalizePrItem", () => {
  it("normalizes a full open-PR record", () => {
    const pr = normalizePrItem(OPEN_PR_FIXTURE, "OPEN");
    expect(pr.number).toBe(53);
    expect(pr.author).toEqual({ login: "davideweaver" });
    expect(pr.state).toBe("OPEN");
    expect(pr.reviewDecision).toBe("");
    expect(pr.mergeable).toBe("UNKNOWN");
    expect(pr.labels).toEqual([{ name: "minor" }]);
    expect(pr.statusCheckRollup).toHaveLength(2);
    expect(pr.latestReviews[0]).toEqual({
      author: { login: "reviewer1" },
      state: "APPROVED",
      submittedAt: "2026-07-17T02:35:00Z",
      body: "",
    });
  });

  it("normalizes both user and team review requests", () => {
    const pr = normalizePrItem(OPEN_PR_FIXTURE, "OPEN");
    expect(pr.reviewRequests).toEqual([
      { login: "reviewer2", name: null },
      { login: null, name: "core" },
    ]);
  });

  it("fills defaults for fields absent from the merged-PR field set", () => {
    const pr = normalizePrItem(
      { number: 7, title: "t", url: "u", mergedAt: "2026-01-01T00:00:00Z" },
      "MERGED",
    );
    expect(pr.state).toBe("MERGED");
    expect(pr.reviewDecision).toBe("");
    expect(pr.statusCheckRollup).toEqual([]);
    expect(pr.reviewRequests).toEqual([]);
    expect(pr.mergeable).toBe("UNKNOWN");
    expect(pr.mergedAt).toBe("2026-01-01T00:00:00Z");
    expect(pr.additions).toBe(0);
  });

  it("tolerates garbage field values", () => {
    const pr = normalizePrItem(
      { number: "x", author: "nope", labels: "bad", statusCheckRollup: [{ __typename: "Mystery" }] },
      "OPEN",
    );
    expect(pr.number).toBe(0);
    expect(pr.author).toBeNull();
    expect(pr.labels).toEqual([]);
    expect(pr.statusCheckRollup).toEqual([]);
  });
});

describe("normalizePrDetail", () => {
  it("normalizes detail-only fields on top of the list shape", () => {
    const detail = normalizePrDetail({
      ...OPEN_PR_FIXTURE,
      state: "OPEN",
      body: "PR description here",
      changedFiles: 4,
      closedAt: null,
      reviews: [{ author: { login: "reviewer1" }, state: "APPROVED", submittedAt: "2026-07-17T02:35:00Z", body: "LGTM" }],
      comments: [{ author: { login: "davideweaver" }, body: "ping", createdAt: "2026-07-17T01:00:00Z", url: "https://github.com/x" }],
    });
    expect(detail.body).toBe("PR description here");
    expect(detail.changedFiles).toBe(4);
    expect(detail.closedAt).toBeNull();
    expect(detail.reviews[0].body).toBe("LGTM");
    expect(detail.comments[0]).toEqual({
      author: { login: "davideweaver" },
      body: "ping",
      createdAt: "2026-07-17T01:00:00Z",
      url: "https://github.com/x",
    });
  });

  it("defaults comments and reviews to empty arrays", () => {
    const detail = normalizePrDetail({ number: 1 });
    expect(detail.comments).toEqual([]);
    expect(detail.reviews).toEqual([]);
    expect(detail.body).toBe("");
  });
});
