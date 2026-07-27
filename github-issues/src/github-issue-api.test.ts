import { describe, it, expect } from "vitest";
import { classifyFetchError, normalizeIssueItem, normalizeIssueDetail } from "./github-issue-api";

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

  it("rate-limit message points at Refresh", () => {
    const err = classifyFetchError("HTTP 429: too many requests");
    expect(err.kind).toBe("rate-limited");
    expect(err.message).toMatch(/Refresh/);
  });
});

// Captured from a real `gh issue list --json …` invocation (trimmed).
const OPEN_ISSUE_FIXTURE = JSON.parse(`{
  "author": { "id": "MDQ6VXNlcjczNzMwOQ==", "is_bot": false, "login": "davideweaver", "name": "Dave Weaver" },
  "assignees": [{ "id": "A1", "login": "davideweaver", "name": "Dave Weaver" }],
  "closedAt": null,
  "createdAt": "2026-07-17T02:34:03Z",
  "labels": [{ "id": "L1", "name": "bug", "color": "d73a4a" }],
  "milestone": { "title": "v0.35" },
  "number": 91,
  "state": "OPEN",
  "stateReason": null,
  "title": "Panel gate flashes on cold start",
  "updatedAt": "2026-07-17T02:37:00Z",
  "url": "https://github.com/silo-code/silo/issues/91"
}`);

describe("normalizeIssueItem", () => {
  it("normalizes a full open-issue record", () => {
    const issue = normalizeIssueItem(OPEN_ISSUE_FIXTURE);
    expect(issue.number).toBe(91);
    expect(issue.author).toEqual({ login: "davideweaver" });
    expect(issue.state).toBe("OPEN");
    expect(issue.stateReason).toBeNull();
    expect(issue.labels).toEqual([{ name: "bug", color: "d73a4a" }]);
    expect(issue.assignees).toEqual([{ login: "davideweaver" }]);
    expect(issue.milestone).toEqual({ title: "v0.35" });
  });

  it("fills defaults for fields absent from a minimal record", () => {
    const issue = normalizeIssueItem({ number: 7, title: "t", url: "u" });
    expect(issue.state).toBe("OPEN");
    expect(issue.stateReason).toBeNull();
    expect(issue.labels).toEqual([]);
    expect(issue.assignees).toEqual([]);
    expect(issue.milestone).toBeNull();
    expect(issue.closedAt).toBeNull();
  });

  it("tolerates garbage field values", () => {
    const issue = normalizeIssueItem({
      number: "x",
      author: "nope",
      labels: "bad",
      assignees: "bad",
      milestone: "bad",
      stateReason: "MYSTERY",
    });
    expect(issue.number).toBe(0);
    expect(issue.author).toBeNull();
    expect(issue.labels).toEqual([]);
    expect(issue.assignees).toEqual([]);
    expect(issue.milestone).toBeNull();
    expect(issue.stateReason).toBeNull();
  });

  it("recognizes CLOSED state and each stateReason value", () => {
    expect(normalizeIssueItem({ state: "CLOSED", stateReason: "COMPLETED" }).state).toBe("CLOSED");
    expect(normalizeIssueItem({ stateReason: "COMPLETED" }).stateReason).toBe("COMPLETED");
    expect(normalizeIssueItem({ stateReason: "NOT_PLANNED" }).stateReason).toBe("NOT_PLANNED");
    expect(normalizeIssueItem({ stateReason: "REOPENED" }).stateReason).toBe("REOPENED");
  });
});

describe("normalizeIssueDetail", () => {
  it("normalizes detail-only fields on top of the list shape", () => {
    const detail = normalizeIssueDetail({
      ...OPEN_ISSUE_FIXTURE,
      body: "Issue description here",
      comments: [{ author: { login: "davideweaver" }, body: "ping", createdAt: "2026-07-17T01:00:00Z", url: "https://github.com/x" }],
    });
    expect(detail.body).toBe("Issue description here");
    expect(detail.comments[0]).toEqual({
      author: { login: "davideweaver" },
      body: "ping",
      createdAt: "2026-07-17T01:00:00Z",
      url: "https://github.com/x",
    });
  });

  it("defaults comments and body to empty", () => {
    const detail = normalizeIssueDetail({ number: 1 });
    expect(detail.comments).toEqual([]);
    expect(detail.body).toBe("");
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
    const { checkAuth } = await import("./github-issue-api");
    const ctx = mockCtx(async () => ({ code: 0, stdout: "Logged in", stderr: "" }));
    expect(await checkAuth(ctx, "gh")).toBe("ok");
  });

  it("returns unauthenticated on non-zero exit that is not missing", async () => {
    const { checkAuth } = await import("./github-issue-api");
    const ctx = mockCtx(async () => ({ code: 1, stdout: "", stderr: "not logged in" }));
    expect(await checkAuth(ctx, "gh")).toBe("unauthenticated");
  });

  it("returns missing when the binary is not found", async () => {
    const { checkAuth } = await import("./github-issue-api");
    const ctx = mockCtx(async () => ({ code: 127, stdout: "", stderr: "gh: command not found" }));
    expect(await checkAuth(ctx, "gh")).toBe("missing");
  });

  it("returns deferred on PathDeniedError", async () => {
    const { checkAuth } = await import("./github-issue-api");
    const ctx = mockCtx(async () => {
      const err = new Error("PathDeniedError: No workspace is open");
      err.name = "PathDeniedError";
      throw err;
    });
    expect(await checkAuth(ctx, "gh")).toBe("deferred");
  });

  it("returns deferred without running gh when no workspace folder is available", async () => {
    const { checkAuth } = await import("./github-issue-api");
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
