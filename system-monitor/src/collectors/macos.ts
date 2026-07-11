import type { ExtensionContext } from "@silo-code/sdk";
import type { Collector, CpuReading, MemReading } from "./types";
import { MEM_COLORS } from "./palette";

// ---------------------------------------------------------------------------
// CPU — `iostat -c 2 -w 1`
// Takes exactly 1 second (one sample delta) at near-zero CPU overhead.
// Output has a header + two data rows; we want the LAST row (the delta).
//
//               disk0       cpu    load average
//     KB/t  tps  MB/s  us sy id   1m   5m   15m
//    25.69  944 23.67  20 10 70  6.05 6.89 7.15   ← since boot (discard)
//    52.27 4076 208.04  41 22 38  6.05 6.89 7.15   ← last 1 s  (use this)
// ---------------------------------------------------------------------------

export function parseIostatOutput(out: string): CpuReading | null {
  const lines = out.trim().split("\n");

  // Find the column header line (e.g. "KB/t  tps  MB/s  us sy id ...")
  // The number of disk columns varies with the number of attached disks.
  const headerLine = lines.find((l) => /\bus\b/.test(l) && /\bsy\b/.test(l));
  if (!headerLine) return null;
  const headers = headerLine.trim().split(/\s+/);
  const userIdx = headers.indexOf("us");
  const sysIdx = headers.indexOf("sy");
  if (userIdx === -1 || sysIdx === -1) return null;

  // Use the last data line (the delta measurement, not the since-boot row).
  const dataLines = lines.filter((l) => /^\s*[\d.]/.test(l));
  const last = dataLines[dataLines.length - 1];
  if (!last) return null;
  const cols = last.trim().split(/\s+/);
  const user = parseFloat(cols[userIdx]);
  const sys = parseFloat(cols[sysIdx]);
  if (isNaN(user) || isNaN(sys)) return null;
  return { user: Math.min(user, 100), sys: Math.min(sys, 100) };
}

// ---------------------------------------------------------------------------
// Memory — `vm_stat` combined with `sysctl -n hw.memsize`, run as one exec:
//   sh -c "vm_stat && sysctl -n hw.memsize"
//
// The last line of stdout is the total RAM in bytes from sysctl; everything
// before it is vm_stat page counts. Page size is declared in the vm_stat header
// (16 384 bytes on Apple Silicon, 4 096 on Intel) so we never hard-code it.
// ---------------------------------------------------------------------------

export function parseVmStatOutput(out: string): MemReading | null {
  const lines = out.trim().split("\n");
  const totalBytes = parseInt(lines[lines.length - 1], 10);
  if (isNaN(totalBytes) || totalBytes === 0) return null;

  const vmPart = lines.slice(0, -1).join("\n");

  const pageSizeMatch = vmPart.match(/page size of (\d+) bytes/i);
  const pageSize = pageSizeMatch ? parseInt(pageSizeMatch[1], 10) : 4096;

  function pages(key: string): number {
    const m = vmPart.match(new RegExp(`${key}:\\s+(\\d+)`));
    return m ? parseInt(m[1], 10) * pageSize : 0;
  }

  // "Anonymous pages" = all non-file-backed pages (active + inactive anonymous),
  // matching Activity Monitor's "App Memory". "Pages active" undercounts it.
  const app = pages("Anonymous pages");
  const wired = pages("Pages wired down");
  // "Pages occupied by compressor" is the *physical* RAM holding compressed
  // data; "Pages stored in compressor" is the larger logical count (wrong here).
  const cache = pages("Pages occupied by compressor");
  // Free = everything not actively committed (inactive, speculative, purgeable).
  const free = totalBytes - wired - app - cache;
  const used = totalBytes - free;

  if (used <= 0 || free < 0) return null;

  return {
    totalBytes,
    usedBytes: used,
    segments: [
      { label: "App", bytes: app, color: MEM_COLORS.used },
      { label: "Wired", bytes: wired, color: MEM_COLORS.wired },
      { label: "Cache", bytes: cache, color: MEM_COLORS.cache },
      { label: "Free", bytes: free, color: MEM_COLORS.free },
    ],
  };
}

export function createMacosCollector(ctx: ExtensionContext): Collector {
  return {
    os: "macos",
    async cpu() {
      const { stdout } = await ctx.process.exec("iostat", ["-c", "2", "-w", "1"]);
      const cpu = parseIostatOutput(stdout);
      if (!cpu) throw new Error("Could not parse iostat output");
      return cpu;
    },
    async memory() {
      const { stdout } = await ctx.process.exec("sh", [
        "-c",
        "vm_stat && sysctl -n hw.memsize",
      ]);
      const mem = parseVmStatOutput(stdout);
      if (!mem) throw new Error("Could not parse vm_stat output");
      return mem;
    },
  };
}
