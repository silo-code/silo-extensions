import { describe, it, expect } from "vitest";
import {
  aggregateRunState,
  deriveStatusBarState,
  deriveWorkspaceStatusBarState,
  selectFailedRuns,
  selectRunningRuns,
  GhActionsStore,
  type WorkspaceGhState,
} from "./store";
import type { WorkflowRun } from "./github-api";

let nextId = 1;
function run(partial: Partial<WorkflowRun>): WorkflowRun {
  return {
    id: nextId++,
    name: "CI",
    status: "completed",
    conclusion: "success",
    html_url: "https://github.com/o/r/actions/runs/1",
    head_branch: "main",
    event: "push",
    run_number: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    pull_requests: [],
    ...partial,
  };
}

const failed = (over: Partial<WorkflowRun> = {}) =>
  run({ status: "completed", conclusion: "failure", ...over });

describe("aggregateRunState", () => {
  it("returns zeros for empty input", () => {
    expect(aggregateRunState([])).toEqual({ failed: 0, running: 0 });
  });

  it("dedupes failures by workflow name", () => {
    const runs = [
      failed({ name: "build", created_at: "2026-01-02T00:00:00Z" }),
      failed({ name: "build", created_at: "2026-01-03T00:00:00Z" }),
      failed({ name: "lint", created_at: "2026-01-03T00:00:00Z" }),
    ];
    expect(aggregateRunState(runs).failed).toBe(2);
  });

  it("counts every in-progress and queued run (no dedup)", () => {
    const runs = [
      run({ status: "in_progress", conclusion: null }),
      run({ status: "queued", conclusion: null }),
      run({ status: "in_progress", conclusion: null }),
    ];
    expect(aggregateRunState(runs).running).toBe(3);
  });

  it("ignores successful and cancelled runs", () => {
    const runs = [run({ conclusion: "success" }), run({ conclusion: "cancelled" })];
    expect(aggregateRunState(runs)).toEqual({ failed: 0, running: 0 });
  });

  it("excludes failures at or before clearedBefore, keeps newer ones", () => {
    const cleared = new Date("2026-01-05T00:00:00Z");
    const runs = [
      failed({ name: "old", created_at: "2026-01-04T00:00:00Z" }),
      failed({ name: "new", created_at: "2026-01-06T00:00:00Z" }),
    ];
    expect(aggregateRunState(runs, cleared).failed).toBe(1);
  });

  it("counts all failures when clearedBefore is undefined", () => {
    const runs = [failed({ name: "a" }), failed({ name: "b" })];
    expect(aggregateRunState(runs).failed).toBe(2);
  });

  it("dismissOnSuccess: hides failure when a newer success exists for the same workflow", () => {
    const runs = [
      failed({ name: "CI", created_at: "2026-01-01T00:00:00Z" }),
      run({ name: "CI", conclusion: "success", created_at: "2026-01-02T00:00:00Z" }),
    ];
    expect(aggregateRunState(runs, undefined, true).failed).toBe(0);
  });

  it("dismissOnSuccess: keeps failure when no success exists for that workflow", () => {
    const runs = [
      failed({ name: "CI", created_at: "2026-01-01T00:00:00Z" }),
      run({ name: "lint", conclusion: "success", created_at: "2026-01-02T00:00:00Z" }),
    ];
    expect(aggregateRunState(runs, undefined, true).failed).toBe(1);
  });

  it("dismissOnSuccess: keeps failure when the only success is older than the failure", () => {
    const runs = [
      run({ name: "CI", conclusion: "success", created_at: "2026-01-01T00:00:00Z" }),
      failed({ name: "CI", created_at: "2026-01-02T00:00:00Z" }),
    ];
    expect(aggregateRunState(runs, undefined, true).failed).toBe(1);
  });

  it("dismissOnSuccess: false keeps all failures regardless of successes", () => {
    const runs = [
      failed({ name: "CI", created_at: "2026-01-01T00:00:00Z" }),
      run({ name: "CI", conclusion: "success", created_at: "2026-01-02T00:00:00Z" }),
    ];
    expect(aggregateRunState(runs, undefined, false).failed).toBe(1);
  });
});

describe("selectFailedRuns", () => {
  it("returns only uncleared failures, newest first", () => {
    const cleared = new Date("2026-01-05T00:00:00Z");
    const runs = [
      failed({ created_at: "2026-01-06T00:00:00Z" }),
      run({ conclusion: "success", created_at: "2026-01-07T00:00:00Z" }),
      failed({ created_at: "2026-01-08T00:00:00Z" }),
      failed({ created_at: "2026-01-04T00:00:00Z" }), // cleared out
    ];
    const result = selectFailedRuns(runs, cleared);
    expect(result.map((r) => r.created_at)).toEqual([
      "2026-01-08T00:00:00Z",
      "2026-01-06T00:00:00Z",
    ]);
  });

  it("dismissOnSuccess: excludes failures superseded by a newer success", () => {
    const runs = [
      failed({ name: "CI", created_at: "2026-01-01T00:00:00Z" }),
      failed({ name: "lint", created_at: "2026-01-02T00:00:00Z" }),
      run({ name: "CI", conclusion: "success", created_at: "2026-01-03T00:00:00Z" }),
    ];
    const result = selectFailedRuns(runs, undefined, true);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("lint");
  });

  it("dismissOnSuccess: keeps failures with no newer success", () => {
    const runs = [
      failed({ name: "CI", created_at: "2026-01-02T00:00:00Z" }),
      run({ name: "CI", conclusion: "success", created_at: "2026-01-01T00:00:00Z" }),
    ];
    const result = selectFailedRuns(runs, undefined, true);
    expect(result).toHaveLength(1);
  });
});

describe("selectRunningRuns", () => {
  it("returns in-progress and queued runs only", () => {
    const runs = [
      run({ status: "in_progress", conclusion: null }),
      run({ status: "queued", conclusion: null }),
      failed(),
      run({ conclusion: "success" }),
    ];
    expect(selectRunningRuns(runs)).toHaveLength(2);
  });
});

describe("deriveStatusBarState", () => {
  const base: WorkspaceGhState = {
    folder: "/repo",
    repoInfo: { owner: "o", repo: "r" },
    branch: "main",
    runs: [],
    lastFetched: new Date(),
    error: null,
  };

  it("is checking when the workspace is unknown", () => {
    expect(deriveStatusBarState(undefined)).toEqual({ kind: "checking" });
  });

  it("maps each error kind", () => {
    expect(deriveStatusBarState({ ...base, error: { kind: "unauthenticated" } }).kind).toBe("unauthenticated");
    expect(deriveStatusBarState({ ...base, error: { kind: "no-repo" } }).kind).toBe("no-repo");
    expect(
      deriveStatusBarState({
        ...base,
        error: { kind: "api-error", error: { kind: "network", message: "down" } },
      }),
    ).toEqual({ kind: "api-error", message: "down" });
  });

  it("is checking when there is no repo info and no error", () => {
    expect(deriveStatusBarState({ ...base, repoInfo: null }).kind).toBe("checking");
  });

  it("returns ok with aggregated counts for a healthy workspace", () => {
    const runs = [failed({ name: "build" }), run({ status: "in_progress", conclusion: null })];
    expect(deriveStatusBarState({ ...base, runs })).toEqual({ kind: "ok", failed: 1, running: 1 });
  });
});

describe("deriveWorkspaceStatusBarState", () => {
  const mkState = (overrides: Partial<WorkspaceGhState> = {}): WorkspaceGhState => ({
    folder: "/repo",
    repoInfo: { owner: "o", repo: "r" },
    branch: "main",
    runs: [],
    lastFetched: new Date(),
    error: null,
    ...overrides,
  });

  it("is checking when there are no folder states", () => {
    expect(deriveWorkspaceStatusBarState([])).toEqual({ kind: "checking" });
  });

  it("is no-repo when all states have no repoInfo", () => {
    expect(deriveWorkspaceStatusBarState([
      mkState({ repoInfo: null, error: { kind: "no-repo" } }),
    ])).toEqual({ kind: "no-repo" });
  });

  it("bubbles up unauthenticated from any repo", () => {
    expect(deriveWorkspaceStatusBarState([
      mkState({ error: { kind: "unauthenticated" }, repoInfo: null }),
      mkState(),
    ]).kind).toBe("unauthenticated");
  });

  it("bubbles up api-error from any repo", () => {
    const result = deriveWorkspaceStatusBarState([
      mkState({ error: { kind: "api-error", error: { kind: "network", message: "timeout" } } }),
      mkState(),
    ]);
    expect(result).toEqual({ kind: "api-error", message: "timeout" });
  });

  it("aggregates failures across multiple repos", () => {
    const states = [
      mkState({ runs: [failed({ name: "build" })] }),
      mkState({ folder: "/repo2", repoInfo: { owner: "o", repo: "r2" }, runs: [failed({ name: "lint" })] }),
    ];
    expect(deriveWorkspaceStatusBarState(states)).toEqual({ kind: "ok", failed: 2, running: 0 });
  });

  it("respects dismissOnSuccess across multiple repos", () => {
    const states = [
      mkState({
        runs: [
          failed({ name: "build", created_at: "2026-01-01T00:00:00Z" }),
          run({ name: "build", conclusion: "success", created_at: "2026-01-02T00:00:00Z" }),
        ],
      }),
      mkState({
        folder: "/repo2",
        repoInfo: { owner: "o", repo: "r2" },
        runs: [failed({ name: "lint", created_at: "2026-01-03T00:00:00Z" })],
      }),
    ];
    expect(deriveWorkspaceStatusBarState(states, undefined, true)).toEqual({ kind: "ok", failed: 1, running: 0 });
  });

  it("aggregates running runs across multiple repos", () => {
    const states = [
      mkState({ runs: [run({ status: "in_progress", conclusion: null })] }),
      mkState({ folder: "/repo2", repoInfo: { owner: "o", repo: "r2" }, runs: [run({ status: "queued", conclusion: null })] }),
    ];
    expect(deriveWorkspaceStatusBarState(states)).toEqual({ kind: "ok", failed: 0, running: 2 });
  });

  it("ignores no-repo folders when other repos have data", () => {
    const states = [
      mkState({ runs: [failed({ name: "CI" })] }),
      mkState({ folder: "/not-github", repoInfo: null, error: { kind: "no-repo" } }),
    ];
    expect(deriveWorkspaceStatusBarState(states)).toEqual({ kind: "ok", failed: 1, running: 0 });
  });
});

describe("GhActionsStore.getWorkspaceEnabled / setWorkspaceEnabled", () => {
  it("defaults to true for a workspace with no stored value", () => {
    const store = new GhActionsStore();
    expect(store.getWorkspaceEnabled("ws-unseen")).toBe(true);
  });

  it("round-trips an explicit false", () => {
    const store = new GhActionsStore();
    store.setWorkspaceEnabled("ws-1", false);
    expect(store.getWorkspaceEnabled("ws-1")).toBe(false);
  });

  it("round-trips an explicit true after being set false", () => {
    const store = new GhActionsStore();
    store.setWorkspaceEnabled("ws-1", false);
    store.setWorkspaceEnabled("ws-1", true);
    expect(store.getWorkspaceEnabled("ws-1")).toBe(true);
  });

  it("tracks each workspace independently", () => {
    const store = new GhActionsStore();
    store.setWorkspaceEnabled("ws-1", false);
    expect(store.getWorkspaceEnabled("ws-1")).toBe(false);
    expect(store.getWorkspaceEnabled("ws-2")).toBe(true);
  });

  it("notifies subscribers on change", () => {
    const store = new GhActionsStore();
    let calls = 0;
    const unsubscribe = store.subscribe(() => calls++);
    store.setWorkspaceEnabled("ws-1", false);
    expect(calls).toBe(1);
    unsubscribe();
    store.setWorkspaceEnabled("ws-1", true);
    expect(calls).toBe(1);
  });
});
