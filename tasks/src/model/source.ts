import type { DetailSection } from "./detail";
import type { Task, TaskDraft, TaskLane, TaskPatch } from "./task";

/**
 * One resolved store of tasks. A source is identified by its **locator** (a
 * dedupe key: two workspaces resolving to the same locator are one source).
 * The provider — Silo, Beads, dex — is an implementation detail *of* a source.
 *
 * In phase 1 the only `providerId` is `"silo"` and the locator is the absolute
 * path to that source's `tasks.jsonl`.
 */
export interface TaskSource {
  /** Stable hash of `${providerId}:${locator}`. */
  readonly id: string;
  readonly providerId: string;
  /** Absolute path to `tasks.jsonl` in phase 1; a `bd where` path later. */
  readonly locator: string;
  readonly scope: "global" | "workspace";
  /** Set when `scope === "workspace"`; used to derive the workspace label. */
  readonly workspaceId?: string;
  /** "Personal" for the global source, else the workspace's name. */
  readonly name: string;
}

/**
 * The only path between a source and its data. Action capability is expressed
 * by **optional methods** — `if (provider.createTask)` is type-safe and can't
 * drift from what the provider actually implements. There is no
 * `TaskProviderCapabilities` flag object (R5).
 */
export interface TaskProvider {
  readonly id: string;
  readonly displayName: string;
  list(source: TaskSource): Promise<readonly Task[]>;
  detail(source: TaskSource, taskId: string): Promise<readonly DetailSection[]>;
  createTask?(source: TaskSource, draft: TaskDraft): Promise<Task>;
  updateTask?(
    source: TaskSource,
    taskId: string,
    patch: TaskPatch,
  ): Promise<Task>;
  setLane?(source: TaskSource, taskId: string, lane: TaskLane): Promise<Task>;
  deleteTask?(source: TaskSource, taskId: string): Promise<void>;
  watch?(source: TaskSource, onChange: () => void): { dispose(): void };
}

/**
 * A tiny stable string hash (djb2) — enough to key a source by its locator
 * without pulling in a crypto dependency. Not for anything security-sensitive.
 */
export function hashLocator(providerId: string, locator: string): string {
  const input = `${providerId}:${locator}`;
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  // >>> 0 to an unsigned 32-bit int, base36 for compactness.
  return (h >>> 0).toString(36);
}
