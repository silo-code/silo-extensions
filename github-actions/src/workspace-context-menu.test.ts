import { describe, it, expect } from "vitest";
import { hasDetectedRepo, hasFailedRuns } from "./workspace-context-menu";
import type { WorkspaceGhState } from "./store";
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

function state(partial: Partial<WorkspaceGhState>): WorkspaceGhState {
  return {
    folder: "/repo",
    repoInfo: { owner: "o", repo: "r" },
    branch: "main",
    runs: [],
    lastFetched: null,
    error: null,
    ...partial,
  };
}

describe("hasDetectedRepo", () => {
  it("is false with no folder states", () => {
    expect(hasDetectedRepo([])).toBe(false);
  });

  it("is false when every folder has no repoInfo", () => {
    expect(hasDetectedRepo([state({ repoInfo: null }), state({ repoInfo: null })])).toBe(false);
  });

  it("is true when at least one folder has repoInfo", () => {
    expect(hasDetectedRepo([state({ repoInfo: null }), state({})])).toBe(true);
  });
});

describe("hasFailedRuns", () => {
  it("is false with no folder states", () => {
    expect(hasFailedRuns([])).toBe(false);
  });

  it("is false when the only failed run is in a folder with no repo", () => {
    const states = [state({ repoInfo: null, runs: [run({ conclusion: "failure" })] })];
    expect(hasFailedRuns(states)).toBe(false);
  });

  it("is false when a detected repo has runs but none failed", () => {
    const states = [state({ runs: [run({ conclusion: "success" })] })];
    expect(hasFailedRuns(states)).toBe(false);
  });

  it("is true when a detected repo has a failed run", () => {
    const states = [state({ runs: [run({ conclusion: "failure" })] })];
    expect(hasFailedRuns(states)).toBe(true);
  });

  it("is true when only one of several repos has a failure", () => {
    const states = [
      state({ folder: "/a", runs: [run({ conclusion: "success" })] }),
      state({ folder: "/b", runs: [run({ conclusion: "failure" })] }),
    ];
    expect(hasFailedRuns(states)).toBe(true);
  });

  it("ignores in-progress runs (no conclusion yet)", () => {
    const states = [state({ runs: [run({ status: "in_progress", conclusion: null })] })];
    expect(hasFailedRuns(states)).toBe(false);
  });
});
