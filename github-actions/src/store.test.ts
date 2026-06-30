import { describe, it, expect } from "vitest";
import {
  aggregateRunState,
  deriveStatusBarState,
  selectFailedRuns,
  selectRunningRuns,
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
