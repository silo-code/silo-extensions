import { describe, it, expect } from "vitest";
import {
  classifyFetchError,
  normalizePrCommitDetail,
  normalizePrFiles,
  normalizePrItem,
  normalizePrDetail,
} from "./github-pr-api";

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

  it("falls back to network with a safe message (no raw stderr)", () => {
    const err = classifyFetchError("dial tcp: lookup api.github.com: no such host");
    expect(err.kind).toBe("network");
    expect(err.message).toMatch(/network|GitHub/i);
    expect(err.message).not.toContain("api.github.com");
  });

  it("provides a generic message for empty stderr", () => {
    const err = classifyFetchError("");
    expect(err.kind).toBe("network");
    expect(err.message).toMatch(/network|GitHub/i);
  });

  it("rate-limit message points at Refresh / Settings", () => {
    const err = classifyFetchError("HTTP 429: too many requests");
    expect(err.kind).toBe("rate-limited");
    expect(err.message).toMatch(/Refresh|Settings/);
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
  "latestReviews": [{ "id": "PRR_kwABC123", "author": { "login": "reviewer1" }, "state": "APPROVED", "submittedAt": "2026-07-17T02:35:00Z" }],
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
      id: "PRR_kwABC123",
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
      reviews: [{ id: "PRR_kwXYZ789", author: { login: "reviewer1" }, state: "APPROVED", submittedAt: "2026-07-17T02:35:00Z", body: "LGTM" }],
      comments: [{ author: { login: "davideweaver" }, body: "ping", createdAt: "2026-07-17T01:00:00Z", url: "https://github.com/x" }],
    });
    expect(detail.body).toBe("PR description here");
    expect(detail.changedFiles).toBe(4);
    expect(detail.closedAt).toBeNull();
    expect(detail.reviews[0].id).toBe("PRR_kwXYZ789");
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

// Captured from a real `gh pr view --json commits` invocation (trimmed).
const COMMITS_FIXTURE = [
  {
    oid: "3f1b638a55da2d177fb23d9e6b6188640db9e9ca",
    messageHeadline: "fix(terminal): detect delimited file paths that contain spaces",
    messageBody: "FILE_PATH_RE excluded spaces from the path character class…",
    authoredDate: "2026-08-01T12:50:51Z",
    committedDate: "2026-08-01T12:50:51Z",
    authors: [
      { id: "u1", name: "davideweaver", email: "davideweaver@users.noreply.github.com", login: "davideweaver" },
      { id: "u2", name: "Claude Sonnet 5", email: "noreply@anthropic.com", login: "claude" },
    ],
  },
];

describe("normalizePrDetail commits", () => {
  it("normalizes the commit list, using only the first (co-)author", () => {
    const detail = normalizePrDetail({ number: 1, commits: COMMITS_FIXTURE });
    expect(detail.commits).toEqual([
      {
        sha: "3f1b638a55da2d177fb23d9e6b6188640db9e9ca",
        shortSha: "3f1b638",
        subject: "fix(terminal): detect delimited file paths that contain spaces",
        authorName: "davideweaver",
        authorLogin: "davideweaver",
        date: "2026-08-01T12:50:51Z",
      },
    ]);
  });

  it("defaults commits to an empty array when the field is absent", () => {
    expect(normalizePrDetail({ number: 1 }).commits).toEqual([]);
  });
});

describe("normalizePrDetail headRefOid/baseRefOid", () => {
  it("normalizes both shas — the diff provider's base/head for the Files page", () => {
    const detail = normalizePrDetail({
      number: 1,
      headRefOid: "4f66d144ee145947ec144d22d3ab758628a9e946",
      baseRefOid: "cc4f4b9c1e21020a4fb1699091a183e3291d2612",
    });
    expect(detail.headRefOid).toBe("4f66d144ee145947ec144d22d3ab758628a9e946");
    expect(detail.baseRefOid).toBe("cc4f4b9c1e21020a4fb1699091a183e3291d2612");
  });

  it("defaults both to empty strings when absent", () => {
    const detail = normalizePrDetail({ number: 1 });
    expect(detail.headRefOid).toBe("");
    expect(detail.baseRefOid).toBe("");
  });
});

// Captured from a real `gh api repos/{owner}/{repo}/commits/{sha}` invocation (trimmed).
const COMMIT_DETAIL_FIXTURE = {
  sha: "3f1b638a55da2d177fb23d9e6b6188640db9e9ca",
  commit: {
    author: {
      name: "davideweaver",
      email: "davideweaver@users.noreply.github.com",
      date: "2026-08-01T12:50:51Z",
    },
    message:
      "fix(terminal): detect delimited file paths that contain spaces\n\nFILE_PATH_RE excluded spaces from the path character class.\n\nCo-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>",
  },
  author: { login: "davideweaver" },
  parents: [{ sha: "4329f879cc75c0c0ffcd581793686fd283706f18" }],
  files: [
    {
      filename: "packages/extensions-core/src/terminal/terminal-link-match.test.ts",
      status: "modified",
      additions: 32,
      deletions: 0,
      previous_filename: null,
    },
    {
      filename: "packages/extensions-core/src/terminal/terminal-link-match.ts",
      status: "modified",
      additions: 36,
      deletions: 2,
      previous_filename: null,
    },
  ],
};

describe("normalizePrCommitDetail", () => {
  it("normalizes message, author, parent, and files from a real REST response", () => {
    const detail = normalizePrCommitDetail(COMMIT_DETAIL_FIXTURE);
    expect(detail.sha).toBe("3f1b638a55da2d177fb23d9e6b6188640db9e9ca");
    expect(detail.shortSha).toBe("3f1b638");
    expect(detail.subject).toBe("fix(terminal): detect delimited file paths that contain spaces");
    expect(detail.body).toContain("Co-Authored-By");
    expect(detail.body).not.toMatch(/^\n/);
    expect(detail.authorLogin).toBe("davideweaver");
    expect(detail.parentSha).toBe("4329f879cc75c0c0ffcd581793686fd283706f18");
    expect(detail.files).toEqual([
      {
        path: "packages/extensions-core/src/terminal/terminal-link-match.test.ts",
        origPath: undefined,
        status: "M",
        additions: 32,
        deletions: 0,
      },
      {
        path: "packages/extensions-core/src/terminal/terminal-link-match.ts",
        origPath: undefined,
        status: "M",
        additions: 36,
        deletions: 2,
      },
    ]);
  });

  it("treats a root commit (no parents) as parentSha: null", () => {
    const detail = normalizePrCommitDetail({
      sha: "abc123",
      commit: { author: {}, message: "root" },
      author: null,
      parents: [],
      files: [],
    });
    expect(detail.parentSha).toBeNull();
    expect(detail.authorLogin).toBeNull();
  });

  it("keeps the previous filename for a rename", () => {
    const detail = normalizePrCommitDetail({
      sha: "abc123",
      commit: { author: {}, message: "rename" },
      parents: [],
      files: [{ filename: "new.ts", previous_filename: "old.ts", status: "renamed", additions: 0, deletions: 0 }],
    });
    expect(detail.files[0]).toEqual({
      path: "new.ts",
      origPath: "old.ts",
      status: "R",
      additions: 0,
      deletions: 0,
    });
  });

  it("maps every GitHub file status to Silo's single-letter convention", () => {
    const detail = normalizePrCommitDetail({
      sha: "s",
      commit: { author: {}, message: "m" },
      parents: [],
      files: [
        { filename: "a", status: "added", additions: 1, deletions: 0 },
        { filename: "b", status: "removed", additions: 0, deletions: 1 },
        { filename: "c", status: "copied", additions: 0, deletions: 0 },
        { filename: "d", status: "mystery-future-status", additions: 0, deletions: 0 },
      ],
    });
    expect(detail.files.map((f) => f.status)).toEqual(["A", "D", "C", "M"]);
  });
});

// Captured from a real `gh api repos/{owner}/{repo}/pulls/{number}/files` invocation.
describe("normalizePrFiles", () => {
  it("normalizes the same shape as a commit's files (shared REST fields)", () => {
    const files = normalizePrFiles([
      {
        additions: 2,
        deletions: 3,
        filename: "github-prs/src/styles.css",
        previous_filename: null,
        status: "modified",
      },
    ]);
    expect(files).toEqual([
      { path: "github-prs/src/styles.css", origPath: undefined, status: "M", additions: 2, deletions: 3 },
    ]);
  });

  it("keeps the previous filename for a rename", () => {
    const files = normalizePrFiles([
      { filename: "new.ts", previous_filename: "old.ts", status: "renamed", additions: 0, deletions: 0 },
    ]);
    expect(files[0]?.origPath).toBe("old.ts");
  });

  it("returns an empty array for a non-array response", () => {
    expect(normalizePrFiles(undefined)).toEqual([]);
    expect(normalizePrFiles({})).toEqual([]);
  });
});

describe("checkAuth", () => {
  function mockCtx(
    exec: (bin: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>,
    workspaces: import("@silo-code/sdk").ExtensionContext["workspaces"] = {
      getState: () => ({ activeId: "ws", open: [{ id: "ws", folder: "/repo" }], all: [] }),
      get: () => ({ id: "ws", folder: "/repo" }),
    } as unknown as import("@silo-code/sdk").ExtensionContext["workspaces"],
  ) {
    return {
      workspaces,
      process: { exec },
      log: { debug: () => {}, info: () => {}, warn: () => {} },
    } as unknown as import("@silo-code/sdk").ExtensionContext;
  }

  it("returns ok when gh auth status exits 0", async () => {
    const { checkAuth } = await import("./github-pr-api");
    const ctx = mockCtx(async () => ({ code: 0, stdout: "Logged in", stderr: "" }));
    expect(await checkAuth(ctx, "gh")).toBe("ok");
  });

  it("returns unauthenticated on non-zero exit that is not missing", async () => {
    const { checkAuth } = await import("./github-pr-api");
    const ctx = mockCtx(async () => ({ code: 1, stdout: "", stderr: "not logged in" }));
    expect(await checkAuth(ctx, "gh")).toBe("unauthenticated");
  });

  it("returns missing when the binary is not found", async () => {
    const { checkAuth } = await import("./github-pr-api");
    const ctx = mockCtx(async () => ({ code: 127, stdout: "", stderr: "gh: command not found" }));
    expect(await checkAuth(ctx, "gh")).toBe("missing");
  });

  it("returns deferred on PathDeniedError", async () => {
    const { checkAuth } = await import("./github-pr-api");
    const ctx = mockCtx(async () => {
      const err = new Error("PathDeniedError: No workspace is open");
      err.name = "PathDeniedError";
      throw err;
    });
    expect(await checkAuth(ctx, "gh")).toBe("deferred");
  });

  it("returns deferred without running gh when no workspace folder is available", async () => {
    const { checkAuth } = await import("./github-pr-api");
    let execCalled = false;
    const ctx = mockCtx(
      async () => {
        execCalled = true;
        return { code: 0, stdout: "", stderr: "" };
      },
      {
        getState: () => ({ activeId: null, open: [], all: [] }),
        get: () => undefined,
      } as unknown as import("@silo-code/sdk").ExtensionContext["workspaces"],
    );
    expect(await checkAuth(ctx, "gh")).toBe("deferred");
    expect(execCalled).toBe(false);
  });
});

// Captured from real `gh api repos/{owner}/{repo}/pulls/{number}/reviews` and
// `.../comments` calls against a review whose GraphQL body was empty but that
// had one inline (file/line-scoped) comment — the exact case that motivated
// fetchPrReviewComments (see its doc comment for why two REST calls are
// needed instead of one).
const REST_REVIEWS_FIXTURE = [
  { id: 4829159578, user: { login: "ani-mehrabyan" }, state: "COMMENTED", body: "", submitted_at: "2026-07-31T14:03:34Z" },
  { id: 4831029177, user: { login: "ani-mehrabyan" }, state: "COMMENTED", body: "", submitted_at: "2026-07-31T18:04:00Z" },
];
const REST_COMMENTS_FIXTURE = [
  {
    id: 3690956831,
    pull_request_review_id: 4829159578,
    path: "frontend/packages/job-booking-panel/src/utils/mapSubmitJobBookingInput.ts",
    line: null,
    body: "No filed ticket yet for this specific gap.",
    user: { login: "ani-mehrabyan" },
    created_at: "2026-07-31T14:03:30Z",
  },
  {
    id: 3692413472,
    pull_request_review_id: 4831029177,
    path: "frontend/packages/job-booking-panel/src/utils/mapSubmitJobBookingInput.ts",
    line: 42,
    body: "Added a ticket for it",
    user: { login: "ani-mehrabyan" },
    created_at: "2026-07-31T18:03:55Z",
  },
];

describe("fetchPrReviewComments", () => {
  function mockCtx(
    exec: (bin: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>,
  ) {
    return {
      process: { exec },
      log: { debug: () => {}, warn: () => {}, error: () => {} },
    } as unknown as import("@silo-code/sdk").ExtensionContext;
  }

  function restFetchStub(bin: string, args: string[]) {
    const endpoint = args[1] ?? "";
    if (endpoint.endsWith("/reviews")) {
      return Promise.resolve({ code: 0, stdout: JSON.stringify(REST_REVIEWS_FIXTURE), stderr: "" });
    }
    if (endpoint.endsWith("/comments")) {
      return Promise.resolve({ code: 0, stdout: JSON.stringify(REST_COMMENTS_FIXTURE), stderr: "" });
    }
    throw new Error(`unexpected endpoint: ${endpoint}`);
  }

  it("matches a review by author+submittedAt and filters comments to its numeric id", async () => {
    const { fetchPrReviewComments } = await import("./github-pr-api");
    const ctx = mockCtx(restFetchStub);
    const result = await fetchPrReviewComments(
      ctx, "o", "r", 346, "ani-mehrabyan", "2026-07-31T18:04:00Z", "/repo", "gh",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]).toEqual({
      id: "3692413472",
      path: "frontend/packages/job-booking-panel/src/utils/mapSubmitJobBookingInput.ts",
      line: 42,
      body: "Added a ticket for it",
      authorLogin: "ani-mehrabyan",
      createdAt: "2026-07-31T18:03:55Z",
    });
  });

  it("matches the other review by its own submittedAt, not the first one found", async () => {
    const { fetchPrReviewComments } = await import("./github-pr-api");
    const ctx = mockCtx(restFetchStub);
    const result = await fetchPrReviewComments(
      ctx, "o", "r", 346, "ani-mehrabyan", "2026-07-31T14:03:34Z", "/repo", "gh",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.comments.map((c) => c.id)).toEqual(["3690956831"]);
  });

  it("resolves to an empty list (not an error) when no REST review matches", async () => {
    const { fetchPrReviewComments } = await import("./github-pr-api");
    const ctx = mockCtx(restFetchStub);
    const result = await fetchPrReviewComments(
      ctx, "o", "r", 346, "someone-else", "2026-01-01T00:00:00Z", "/repo", "gh",
    );
    expect(result).toEqual({ ok: true, comments: [] });
  });

  it("returns an error when the reviews call fails", async () => {
    const { fetchPrReviewComments } = await import("./github-pr-api");
    const ctx = mockCtx(async () => ({ code: 1, stdout: "", stderr: "HTTP 404: Not Found" }));
    const result = await fetchPrReviewComments(
      ctx, "o", "r", 346, "ani-mehrabyan", "2026-07-31T18:04:00Z", "/repo", "gh",
    );
    expect(result.ok).toBe(false);
  });
});
