import type { WorkflowRun } from "./github-api";

/** Failed runs whose ids are not yet in `seen`. Marks each as seen. */
export function takeUnseenFailedRuns(
  runs: WorkflowRun[],
  seen: Set<number>,
): WorkflowRun[] {
  const fresh: WorkflowRun[] = [];
  for (const run of runs) {
    if (run.status !== "completed" || run.conclusion !== "failure") continue;
    if (seen.has(run.id)) continue;
    seen.add(run.id);
    fresh.push(run);
  }
  return fresh;
}

/** One toast message for a batch of newly detected failures. */
export function formatFailureToastMessage(failures: WorkflowRun[]): string {
  if (failures.length === 0) return "";
  if (failures.length === 1) {
    const run = failures[0]!;
    const branch = run.head_branch || "unknown branch";
    return `"${run.name}" failed on ${branch}`;
  }
  return `${failures.length} workflows failed`;
}
