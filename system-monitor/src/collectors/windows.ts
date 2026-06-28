import type { ExtensionContext } from "@silo-code/sdk";
import type { Collector, CpuReading, MemReading } from "./types";
import { MEM_COLORS } from "./palette";

// Windows metrics come from Windows PowerShell (`powershell.exe`, present on
// every supported Windows install — we don't assume PowerShell 7's `pwsh`).
// `-NoProfile -NonInteractive` keeps startup fast and side-effect-free.
//
// Spawning PowerShell is comparatively expensive (~100–300 ms of startup), so a
// single poll fetches CPU *and* memory in one invocation and the two collector
// methods coalesce onto that one process (see createWindowsCollector). One
// script emits four numbers, in order:
//   1. \Processor(_Total)\% User Time        → CPU user
//   2. \Processor(_Total)\% Privileged Time  → CPU system (kernel)
//   3. Win32_OperatingSystem TotalVisibleMemorySize (KB)
//   4. Win32_OperatingSystem FreePhysicalMemory      (KB)
const PS_FLAGS = ["-NoProfile", "-NonInteractive", "-Command"];

const SAMPLE_PS =
  "(Get-Counter '\\Processor(_Total)\\% User Time','\\Processor(_Total)\\% Privileged Time')" +
  ".CounterSamples | ForEach-Object { $_.CookedValue };" +
  "$o=Get-CimInstance Win32_OperatingSystem;" +
  "Write-Output $o.TotalVisibleMemorySize;Write-Output $o.FreePhysicalMemory";

/** Pull the leading numbers out of stdout, tolerating locale decimal commas. */
function numbers(stdout: string): number[] {
  return stdout
    .split("\n")
    .map((l) => l.trim().replace(",", "."))
    .filter((l) => /^-?\d/.test(l))
    .map(Number)
    .filter((n) => !Number.isNaN(n));
}

const clampPct = (n: number): number => Math.max(0, Math.min(n, 100));

export interface WindowsSample {
  cpu: CpuReading | null;
  mem: MemReading | null;
}

/** Parse the four-number output of SAMPLE_PS into CPU and memory readings. */
export function parseWindowsSample(stdout: string): WindowsSample {
  const [user, sys, totalKb, freeKb] = numbers(stdout);

  const cpu: CpuReading | null =
    user !== undefined && sys !== undefined
      ? { user: clampPct(user), sys: clampPct(sys) }
      : null;

  let mem: MemReading | null = null;
  // Windows doesn't expose a cheap app/wired/cache split, so the donut is the
  // honest two-slice Used / Free.
  if (totalKb !== undefined && freeKb !== undefined && totalKb !== 0) {
    const totalBytes = totalKb * 1024;
    const free = Math.min(freeKb * 1024, totalBytes);
    const used = totalBytes - free;
    mem = {
      totalBytes,
      usedBytes: used,
      segments: [
        { label: "Used", bytes: used, color: MEM_COLORS.used },
        { label: "Free", bytes: free, color: MEM_COLORS.free },
      ],
    };
  }

  return { cpu, mem };
}

export function createWindowsCollector(ctx: ExtensionContext): Collector {
  // Coalesce the cpu()/memory() calls of a single poll onto one PowerShell
  // process: whichever runs first starts the sample, the other awaits the same
  // in-flight promise. Cleared once it settles so the next poll re-samples.
  let inflight: Promise<WindowsSample> | null = null;

  function sample(): Promise<WindowsSample> {
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const { stdout } = await ctx.process.exec("powershell", [
          ...PS_FLAGS,
          SAMPLE_PS,
        ]);
        return parseWindowsSample(stdout);
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  return {
    os: "windows",
    async cpu() {
      const { cpu } = await sample();
      if (!cpu) throw new Error("Could not parse Get-Counter output");
      return cpu;
    },
    async memory() {
      const { mem } = await sample();
      if (!mem) throw new Error("Could not parse Win32_OperatingSystem output");
      return mem;
    },
  };
}
