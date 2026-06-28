import type { ExtensionContext } from "@silo-code/sdk";
import type { Collector, CpuReading, MemReading } from "./types";
import { MEM_COLORS } from "./palette";

// ---------------------------------------------------------------------------
// CPU — /proc/stat
//
// The aggregate line is cumulative jiffies since boot:
//   cpu  user nice system idle iowait irq softirq steal guest guest_nice
// Instantaneous load is the *delta* between two reads, so we keep the previous
// snapshot and diff against it each poll (≈POLL_MS apart) — the first sample has
// nothing to compare to and yields null. Reading a file (vs. shelling out to
// `top`/`mpstat`) keeps this dependency-free and avoids spawning a subprocess.
// ---------------------------------------------------------------------------

/** Aggregated jiffy counters from the `cpu` line of /proc/stat. */
export interface ProcStatCpu {
  /** user + nice (time in user mode). */
  user: number;
  /** system + irq + softirq (time in kernel mode). */
  sys: number;
  /** Sum of every counter, including idle/iowait. */
  total: number;
}

export function parseProcStat(text: string): ProcStatCpu | null {
  const line = text.split("\n").find((l) => /^cpu\s/.test(l));
  if (!line) return null;
  const nums = line.trim().split(/\s+/).slice(1).map(Number);
  if (nums.length < 4 || nums.some(Number.isNaN)) return null;
  // idle/iowait are folded into `total`; we only surface user/sys explicitly.
  const [user, nice, system, , , irq = 0, softirq = 0] = nums;
  return {
    user: user + nice,
    sys: system + irq + softirq,
    total: nums.reduce((a, b) => a + b, 0),
  };
}

/** Percentage load between two cumulative snapshots; null if no time elapsed. */
export function cpuDelta(
  prev: ProcStatCpu,
  cur: ProcStatCpu,
): CpuReading | null {
  const dTotal = cur.total - prev.total;
  if (dTotal <= 0) return null;
  const user = ((cur.user - prev.user) / dTotal) * 100;
  const sys = ((cur.sys - prev.sys) / dTotal) * 100;
  return {
    user: Math.max(0, Math.min(user, 100)),
    sys: Math.max(0, Math.min(sys, 100)),
  };
}

// ---------------------------------------------------------------------------
// Memory — /proc/meminfo (values in kB)
//
// We mirror the kernel's own accounting: `MemAvailable` is its estimate of what
// new apps can claim without swapping, so "used" = total − available is the
// honest in-use figure. The reclaimable remainder (cache that could be evicted)
// is shown separately from genuinely free pages:
//   Used  = MemTotal − MemAvailable
//   Cache = MemAvailable − MemFree   (reclaimable buffers/cache)
//   Free  = MemFree
// The three sum to MemTotal.
// ---------------------------------------------------------------------------

function meminfoKb(text: string, key: string): number | null {
  const m = text.match(new RegExp(`^${key}:\\s+(\\d+)\\s*kB`, "m"));
  return m ? parseInt(m[1], 10) * 1024 : null;
}

export function parseMeminfo(text: string): MemReading | null {
  const total = meminfoKb(text, "MemTotal");
  const free = meminfoKb(text, "MemFree");
  if (total === null || free === null || total === 0) return null;

  // MemAvailable is present on Linux 3.14+; fall back to the classic estimate.
  let available = meminfoKb(text, "MemAvailable");
  if (available === null) {
    const buffers = meminfoKb(text, "Buffers") ?? 0;
    const cached = meminfoKb(text, "Cached") ?? 0;
    const reclaim = meminfoKb(text, "SReclaimable") ?? 0;
    available = free + buffers + cached + reclaim;
  }
  available = Math.min(available, total);

  const used = total - available;
  const cache = Math.max(0, available - free);

  return {
    totalBytes: total,
    usedBytes: used,
    segments: [
      { label: "Used", bytes: used, color: MEM_COLORS.used },
      { label: "Cache", bytes: cache, color: MEM_COLORS.cache },
      { label: "Free", bytes: free, color: MEM_COLORS.free },
    ],
  };
}

export function createLinuxCollector(ctx: ExtensionContext): Collector {
  let prev: ProcStatCpu | null = null;
  return {
    os: "linux",
    async cpu() {
      const cur = parseProcStat(await ctx.files.readText("/proc/stat"));
      if (!cur) throw new Error("Could not parse /proc/stat");
      const reading = prev ? cpuDelta(prev, cur) : null;
      prev = cur;
      return reading; // null on the first poll (no previous snapshot yet)
    },
    async memory() {
      const mem = parseMeminfo(await ctx.files.readText("/proc/meminfo"));
      if (!mem) throw new Error("Could not parse /proc/meminfo");
      return mem;
    },
  };
}
