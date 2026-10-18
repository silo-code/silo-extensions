/**
 * The workspace rollup as the Workspaces panel paints it: a dot per label in
 * use, then the count, then the age of the newest mark.
 *
 * Split out of `store.ts` because the rollup there is *counts* — this is the
 * part that needs the user's label list to know what order the dots go in and
 * what each one is called. Pure — `import type` only.
 */

import type { FollowUpLabel, LabelId } from "./labels";

/** One label that has at least one live mark in a workspace. */
export interface LabelCount {
  label: FollowUpLabel;
  count: number;
}

/**
 * The labels present in a workspace, in the **user's** label order — the same
 * order the dropdown and the settings list use, so the dot cluster reads the
 * same way everywhere. Labels with no live mark are dropped entirely.
 */
export function labelBreakdown(
  labels: readonly FollowUpLabel[],
  byLabel: Partial<Record<LabelId, number>>,
): LabelCount[] {
  const out: LabelCount[] = [];
  for (const label of labels) {
    const count = byLabel[label.id] ?? 0;
    if (count > 0) out.push({ label, count });
  }
  return out;
}

/**
 * The breakdown as one spoken line — the row's `title` and its `aria-label`,
 * since the dots themselves carry color and nothing else.
 *
 * `"2 Blocked · 1 Needs review"`, matching the `·` separator the rest of the
 * extension's meta lines use.
 */
export function breakdownText(entries: readonly LabelCount[]): string {
  return entries.map((e) => `${e.count} ${e.label.name}`).join(" · ");
}
