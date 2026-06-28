// Shared, platform-agnostic metric helpers. The per-OS sampling and parsing
// lives in `collectors/` (one module per platform); this file holds only the
// pieces every collector and view share: the CPU history ring buffer, byte
// formatting, and the poll cadence.

export const POLL_MS = 2000;
export const MAX_SAMPLES = 150; // ~5 min at 2 s

// ---------------------------------------------------------------------------
// CPU history
// ---------------------------------------------------------------------------

/** One CPU sample: user vs. system time, each a 0–100 percentage. */
export type CpuSample = { user: number; sys: number };

export function pushCpuSample(
  history: CpuSample[],
  user: number,
  sys: number,
): CpuSample[] {
  const trimmed = history.length >= MAX_SAMPLES ? history.slice(1) : history;
  return [...trimmed, { user, sys }];
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatBytes(bytes: number): string {
  const GiB = 1024 ** 3;
  const MiB = 1024 ** 2;
  if (bytes >= GiB) return `${(bytes / GiB).toFixed(1)} GB`;
  if (bytes >= MiB) return `${Math.round(bytes / MiB)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
