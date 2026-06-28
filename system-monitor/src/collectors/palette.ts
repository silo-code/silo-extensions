// Shared data-viz series colors for memory segments, so the donut, compact bar,
// and status tooltips look consistent across every platform's breakdown.
//
// These are intentionally literal hex values, not `--silo-*` theme tokens:
// they're a categorical chart palette (like a pie chart's slice colors), chosen
// to stay distinct in both light and dark themes. Theme tokens drive the
// surrounding chrome; these drive the data.

export const MEM_COLORS = {
  /** App / actively-used memory (macOS "App", Linux/Windows "Used"). */
  used: "#e3b341",
  /** Kernel-wired memory (macOS only). */
  wired: "#f47067",
  /** Reclaimable cache / compressed pages (macOS "Cache", Linux buff/cache). */
  cache: "#4493f8",
  /** Free / available. */
  free: "#3fb950",
} as const;
