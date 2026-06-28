import { formatBytes } from "../../metrics";
import type { MemData } from "../../store";

/**
 * Build the status-bar tooltip line from a memory snapshot's segments, e.g.
 * "App 6.1 GB · Wired 2.0 GB · Cache 1.2 GB · Free 8.7 GB" on macOS or
 * "Used 4.3 GB · Cache 2.1 GB · Free 1.6 GB" on Linux. Whatever the active
 * collector reported is what gets listed, in order.
 */
export function segmentTooltip(data: MemData): string {
  return data.segments
    .map((s) => `${s.label} ${formatBytes(s.bytes)}`)
    .join("  ·  ");
}
