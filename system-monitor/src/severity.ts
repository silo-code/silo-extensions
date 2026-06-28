// Maps a 0–100 resource "load" to a severity level and the inline color the
// status-bar items use to signal it. Both CPU (userPct + sysPct) and memory
// (usedBytes / totalBytes) reduce to a single load number, so one helper drives
// every status rendering.
//
// Colors are hex literals applied inline, matching the extension's convention
// for data-driven color (see MEM_COLORS in collectors/palette.ts): theme tokens
// drive the chrome, these drive the data. We reuse the donut's amber/red hues so
// a "hot" status item matches the chart palette.

export type Severity = "normal" | "warning" | "critical";

/** Load percentages at or above which a metric is warning / critical. */
export const SEVERITY_THRESHOLDS = { warning: 75, critical: 90 } as const;

/** Inline color per severity; `null` means inherit the normal chrome color. */
export const SEVERITY_COLORS: Record<Severity, string | null> = {
  normal: null,
  warning: "#e3b341", // amber — matches MEM_COLORS.used
  critical: "#f47067", // red — matches MEM_COLORS.wired
};

export function severityFor(pct: number): Severity {
  if (pct >= SEVERITY_THRESHOLDS.critical) return "critical";
  if (pct >= SEVERITY_THRESHOLDS.warning) return "warning";
  return "normal";
}

/** The inline color override for a load value, or `null` when normal. */
export function severityColor(pct: number): string | null {
  return SEVERITY_COLORS[severityFor(pct)];
}
