import { describe, it, expect } from "vitest";
import type { WorkflowRun } from "./github-api";
import { takeUnseenFailedRuns, formatFailureToastMessage } from "./failure-notifications";

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

describe("takeUnseenFailedRuns", () => {
  it("returns only new failures and marks them seen", () => {
    const seen = new Set<number>();
    const a = failed({ id: 1, name: "A" });
    const b = failed({ id: 2, name: "B" });
    const ok = run({ id: 3, conclusion: "success" });

    expect(takeUnseenFailedRuns([a, ok, b], seen)).toEqual([a, b]);
    expect([...seen]).toEqual([1, 2]);
  });

  it("skips failures already in seen", () => {
    const seen = new Set([1]);
    const a = failed({ id: 1 });
    const b = failed({ id: 2 });

    expect(takeUnseenFailedRuns([a, b], seen)).toEqual([b]);
    expect(seen.has(1)).toBe(true);
    expect(seen.has(2)).toBe(true);
  });

  it("ignores non-failure conclusions and incomplete runs", () => {
    const seen = new Set<number>();
    const runs = [
      run({ id: 1, status: "in_progress", conclusion: null }),
      run({ id: 2, conclusion: "cancelled" }),
      failed({ id: 3 }),
    ];
    expect(takeUnseenFailedRuns(runs, seen).map((r) => r.id)).toEqual([3]);
  });
});

describe("formatFailureToastMessage", () => {
  it("formats a single failure with branch", () => {
    expect(formatFailureToastMessage([failed({ name: "Check PR", head_branch: "crap/maintenance" })])).toBe(
      `"Check PR" failed on crap/maintenance`,
    );
  });

  it("uses unknown branch when head_branch is empty", () => {
    expect(formatFailureToastMessage([failed({ name: "CI", head_branch: "" })])).toBe(
      `"CI" failed on unknown branch`,
    );
  });

  it("summarizes multiple failures as a count", () => {
    expect(
      formatFailureToastMessage([
        failed({ name: "A" }),
        failed({ name: "B" }),
        failed({ name: "C" }),
      ]),
    ).toBe("3 workflows failed");
  });

  it("returns empty string for no failures", () => {
    expect(formatFailureToastMessage([])).toBe("");
  });
});
