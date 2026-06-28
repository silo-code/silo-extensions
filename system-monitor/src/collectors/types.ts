import type { SystemInfo } from "@silo-code/sdk";
import type { MemSegment } from "../store";

/** A single CPU sample as user vs. system percentages (each 0–100). */
export interface CpuReading {
  user: number;
  sys: number;
}

/**
 * A memory snapshot. `segments` is the platform's breakdown (ordered, summing to
 * `totalBytes`); `usedBytes` is `totalBytes` minus the trailing free slice.
 */
export interface MemReading {
  totalBytes: number;
  usedBytes: number;
  segments: MemSegment[];
}

/**
 * Per-platform metric source. The host tells us the OS via `ctx.system`, we
 * pick the matching collector once, and the poll loop calls these two methods.
 *
 * Both resolve to `null` for an *expected* absence of data (e.g. the first
 * Linux CPU sample has no previous delta to compare against) and **throw** for a
 * genuine failure (command missing, output unparseable) so the poll loop can
 * surface a clear, platform-specific error instead of silently flatlining.
 */
export interface Collector {
  readonly os: SystemInfo["os"];
  cpu(): Promise<CpuReading | null>;
  memory(): Promise<MemReading | null>;
}
