/**
 * The normalized **core** task model — the lowest common denominator every
 * provider maps into. It holds only what a list sorts, filters, groups, or
 * lays out by, plus (R15) `descriptionPreview` — a display-only truncated
 * string, not sorted/filtered/grouped by, carried because the sheet's
 * multiline row shows one. Everything else richer (the full description,
 * due date, acceptance criteria, dependencies) reaches the UI as a
 * provider-rendered {@link DetailSection}, never as a field here.
 *
 * Nothing in this file imports React or `ctx`; it is pure data.
 */

/** The closed set of lanes every provider maps its own statuses into. */
export type TaskLane = "todo" | "in_progress" | "blocked" | "done";

/** The closed set of priorities. `"normal"` renders as a neutral dash. */
export type TaskPriority = "high" | "normal" | "low";

/**
 * One task, normalized. A superset lives on disk per provider
 * ({@link import("../providers/silo/record").SiloTaskRecord}); this is what the
 * views actually consume.
 */
export interface Task {
  readonly id: string;
  readonly sourceId: string;
  readonly title: string;
  readonly lane: TaskLane;
  /** The provider's own word for the status — display only, never grouped/sorted by. */
  readonly statusLabel: string;
  readonly priority: TaskPriority;
  /**
   * Ordering key within the source; lexicographically sortable. Append-order in
   * phase 1 (a zero-padded counter) — there is no manual reordering surface, so
   * no insert-between generator is built.
   */
  readonly rank: string;
  /** Carried and round-tripped; not rendered in phase 1 (no nesting surface). */
  readonly parentId: string | null;
  readonly labels: readonly string[];
  /** Carried and round-tripped; not editable in phase 1 (no user directory). */
  readonly assignees: readonly string[];
  readonly updatedAt: number;
  /**
   * A short, plain-text preview of the task's description, if the provider
   * has one — truncated (see `lib/text.ts`'s `truncatePreview`), for a list
   * row to show a line of context under the title (R15). This is **not**
   * the full description: that stays exclusively on a provider's
   * `DetailSection` (never round-tripped through a patch), same as every
   * other rich field this core model deliberately excludes. Absent when the
   * provider has no description or doesn't support one.
   */
  readonly descriptionPreview?: string;
}

/**
 * What {@link import("./source").TaskProvider.createTask} accepts. `title` is
 * required; everything else is optional and provider-defaulted.
 */
export interface TaskDraft {
  title: string;
  lane?: TaskLane;
  priority?: TaskPriority;
  labels?: readonly string[];
  /**
   * Non-core fields for the creating provider, keyed by
   * {@link DetailSection.key} — the same channel {@link TaskPatch} uses. The
   * core never names a provider-specific field.
   */
  providerFields?: Readonly<Record<string, unknown>>;
}

/**
 * An edit to an existing task. Names **only** core-model fields, plus one
 * opaque bag: a provider hands the UI a {@link DetailSection} carrying a `key`,
 * and an edit to that section comes back here as `providerFields[key]`. This is
 * what keeps provider-specific vocabulary off the one type the whole seam
 * shares (R5) — in both directions.
 */
export interface TaskPatch {
  title?: string;
  lane?: TaskLane;
  priority?: TaskPriority;
  labels?: readonly string[];
  /** Edits to provider-specific fields, keyed by `DetailSection.key`. */
  providerFields?: Readonly<Record<string, unknown>>;
}

/** Human word for a lane — the Silo provider's `statusLabel`. */
export const LANE_LABELS: Record<TaskLane, string> = {
  todo: "Todo",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};

export const ALL_LANES: readonly TaskLane[] = [
  "todo",
  "in_progress",
  "blocked",
  "done",
];

/** Human word for a priority — used by the detail-page Priority control. */
export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  high: "High",
  normal: "Normal",
  low: "Low",
};

export const ALL_PRIORITIES: readonly TaskPriority[] = ["high", "normal", "low"];
