import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseGitHubRemote } from "./parse-remote";
import { aggregateRunState, deriveStatusBarState, type WorkspaceGhState } from "./store";
import type { WorkflowRun } from "./github-api";

// ─── parseGitHubRemote ────────────────────────────────────────────────────────

describe("parseGitHubRemote", () => {
  it("parses SSH URL with .git suffix", () => {
    expect(parseGitHubRemote("git@github.com:acme/my-repo.git")).toEqual({
      owner: "acme",
      repo: "my-repo",
    });
  });

  it("parses SSH URL without .git suffix", () => {
    expect(parseGitHubRemote("git@github.com:acme/my-repo")).toEqual({
      owner: "acme",
      repo: "my-repo",
    });
  });

  it("parses HTTPS URL with .git suffix", () => {
    expect(parseGitHubRemote("https://github.com/acme/my-repo.git")).toEqual({
      owner: "acme",
      repo: "my-repo",
    });
  });

  it("parses HTTPS URL without .git suffix", () => {
    expect(parseGitHubRemote("https://github.com/acme/my-repo")).toEqual({
      owner: "acme",
      repo: "my-repo",
    });
  });

  it("returns null for non-GitHub SSH remote", () => {
    expect(parseGitHubRemote("git@gitlab.com:acme/my-repo.git")).toBeNull();
  });

  it("returns null for non-GitHub HTTPS remote", () => {
    expect(parseGitHubRemote("https://bitbucket.org/acme/my-repo.git")).toBeNull();
  });

  it("handles leading/trailing whitespace", () => {
    expect(parseGitHubRemote("  git@github.com:acme/repo.git  ")).toEqual({
      owner: "acme",
      repo: "repo",
    });
  });

  it("returns null for empty string", () => {
    expect(parseGitHubRemote("")).toBeNull();
  });
});

// ─── aggregateRunState ────────────────────────────────────────────────────────

function makeRun(
  id: number,
  status: WorkflowRun["status"],
  conclusion: WorkflowRun["conclusion"] = null,
): WorkflowRun {
  return {
    id,
    name: `Workflow ${id}`,
    status,
    conclusion,
    html_url: `https://github.com/acme/repo/actions/runs/${id}`,
    head_branch: "main",
    event: "push",
    run_number: id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    pull_requests: [],
  };
}

describe("aggregateRunState", () => {
  it("returns zeros for empty run list", () => {
    expect(aggregateRunState([])).toEqual({ failed: 0, running: 0 });
  });

  it("counts in_progress runs as running", () => {
    expect(aggregateRunState([makeRun(1, "in_progress")])).toEqual({ failed: 0, running: 1 });
  });

  it("counts queued runs as running", () => {
    expect(aggregateRunState([makeRun(1, "queued")])).toEqual({ failed: 0, running: 1 });
  });

  it("counts completed failure as failed", () => {
    expect(aggregateRunState([makeRun(1, "completed", "failure")])).toEqual({ failed: 1, running: 0 });
  });

  it("does not count completed success as failed or running", () => {
    expect(aggregateRunState([makeRun(1, "completed", "success")])).toEqual({ failed: 0, running: 0 });
  });

  it("aggregates multiple runs correctly", () => {
    const runs = [
      makeRun(1, "in_progress"),
      makeRun(2, "completed", "failure"),
      makeRun(3, "completed", "failure"),
      makeRun(4, "completed", "success"),
      makeRun(5, "queued"),
    ];
    expect(aggregateRunState(runs)).toEqual({ failed: 2, running: 2 });
  });
});

// ─── deriveStatusBarState ─────────────────────────────────────────────────────

function makeWsState(
  overrides: Partial<WorkspaceGhState> = {},
): WorkspaceGhState {
  return {
    repoInfo: { owner: "acme", repo: "repo" },
    branch: "main",
    runs: [],
    lastFetched: new Date(),
    error: null,
    ...overrides,
  };
}

describe("deriveStatusBarState", () => {
  it("returns hidden when workspace state is undefined", () => {
    expect(deriveStatusBarState(undefined)).toEqual({ kind: "hidden" });
  });

  it("returns unauthenticated when error is unauthenticated", () => {
    expect(
      deriveStatusBarState(makeWsState({ error: { kind: "unauthenticated" } })),
    ).toEqual({ kind: "unauthenticated" });
  });

  it("returns hidden when no repo detected", () => {
    expect(
      deriveStatusBarState(makeWsState({ error: { kind: "no-repo" }, repoInfo: null })),
    ).toEqual({ kind: "hidden" });
  });

  it("returns api-error when error is api-error", () => {
    const state = deriveStatusBarState(
      makeWsState({
        error: { kind: "api-error", error: { kind: "rate-limited", message: "Rate limited" } },
      }),
    );
    expect(state).toEqual({ kind: "api-error", message: "Rate limited" });
  });

  it("returns hidden when repoInfo is null and no error", () => {
    expect(deriveStatusBarState(makeWsState({ repoInfo: null }))).toEqual({ kind: "hidden" });
  });

  it("returns ok with zero counts for empty runs", () => {
    expect(deriveStatusBarState(makeWsState({ runs: [] }))).toEqual({
      kind: "ok",
      failed: 0,
      running: 0,
    });
  });

  it("returns correct failed+running counts", () => {
    const runs = [
      makeRun(1, "in_progress"),
      makeRun(2, "completed", "failure"),
    ];
    expect(deriveStatusBarState(makeWsState({ runs }))).toEqual({
      kind: "ok",
      failed: 1,
      running: 1,
    });
  });
});

// ─── Seen-run dedup (notification logic) ─────────────────────────────────────

describe("seen-run dedup logic", () => {
  it("tracks run IDs to avoid duplicate notifications", () => {
    const seen = new Set<number>();
    const notify = vi.fn();

    const runs = [makeRun(42, "completed", "failure")];

    // First pass
    for (const run of runs) {
      if (run.status === "completed" && run.conclusion === "failure" && !seen.has(run.id)) {
        seen.add(run.id);
        notify(run.id);
      }
    }
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(42);

    // Second pass — same runs
    for (const run of runs) {
      if (run.status === "completed" && run.conclusion === "failure" && !seen.has(run.id)) {
        seen.add(run.id);
        notify(run.id);
      }
    }
    expect(notify).toHaveBeenCalledTimes(1); // not called again
  });

  it("fires for a new failure run not yet seen", () => {
    const seen = new Set<number>([1, 2, 3]);
    const notify = vi.fn();

    const runs = [
      makeRun(1, "completed", "failure"),
      makeRun(4, "completed", "failure"), // new
    ];

    for (const run of runs) {
      if (run.status === "completed" && run.conclusion === "failure" && !seen.has(run.id)) {
        seen.add(run.id);
        notify(run.id);
      }
    }
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(4);
  });
});
