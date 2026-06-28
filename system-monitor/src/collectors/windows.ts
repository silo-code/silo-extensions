import type { ExtensionContext } from "@silo-code/sdk";
import type { Collector, CpuReading, MemReading } from "./types";
import { MEM_COLORS } from "./palette";

// Windows metrics come from Windows PowerShell (`powershell.exe`, present on
// every supported Windows install — we don't assume PowerShell 7's `pwsh`).
// `-NoProfile -NonInteractive` keeps startup fast and side-effect-free.
const PS_FLAGS = ["-NoProfile", "-NonInteractive", "-Command"];

// ---------------------------------------------------------------------------
// CPU — two performance counters give us the same user/system split the other
// platforms report:
//   \Processor(_Total)\% User Time       → user
//   \Processor(_Total)\% Privileged Time → system (kernel)
// CounterSamples come back in counter-path order, one CookedValue per line.
// ---------------------------------------------------------------------------

const CPU_PS =
  "(Get-Counter '\\Processor(_Total)\\% User Time','\\Processor(_Total)\\% Privileged Time')" +
  ".CounterSamples | ForEach-Object { $_.CookedValue }";

/** Pull the leading numbers out of stdout, tolerating locale decimal commas. */
function numbers(stdout: string): number[] {
  return stdout
    .split("\n")
    .map((l) => l.trim().replace(",", "."))
    .filter((l) => /^-?\d/.test(l))
    .map(Number)
    .filter((n) => !Number.isNaN(n));
}

export function parseWindowsCpu(stdout: string): CpuReading | null {
  const [user, sys] = numbers(stdout);
  if (user === undefined || sys === undefined) return null;
  return {
    user: Math.max(0, Math.min(user, 100)),
    sys: Math.max(0, Math.min(sys, 100)),
  };
}

// ---------------------------------------------------------------------------
// Memory — Win32_OperatingSystem reports total and free in **kilobytes**.
// Windows doesn't expose a cheap app/wired/cache split, so the donut is the
// honest two-slice Used / Free.
// ---------------------------------------------------------------------------

const MEM_PS =
  "$o=Get-CimInstance Win32_OperatingSystem;" +
  "Write-Output $o.TotalVisibleMemorySize;Write-Output $o.FreePhysicalMemory";

export function parseWindowsMem(stdout: string): MemReading | null {
  const [totalKb, freeKb] = numbers(stdout);
  if (totalKb === undefined || freeKb === undefined || totalKb === 0)
    return null;
  const totalBytes = totalKb * 1024;
  const free = Math.min(freeKb * 1024, totalBytes);
  const used = totalBytes - free;
  return {
    totalBytes,
    usedBytes: used,
    segments: [
      { label: "Used", bytes: used, color: MEM_COLORS.used },
      { label: "Free", bytes: free, color: MEM_COLORS.free },
    ],
  };
}

export function createWindowsCollector(ctx: ExtensionContext): Collector {
  return {
    os: "windows",
    async cpu() {
      const { stdout } = await ctx.process.exec("powershell", [
        ...PS_FLAGS,
        CPU_PS,
      ]);
      const cpu = parseWindowsCpu(stdout);
      if (!cpu) throw new Error("Could not parse Get-Counter output");
      return cpu;
    },
    async memory() {
      const { stdout } = await ctx.process.exec("powershell", [
        ...PS_FLAGS,
        MEM_PS,
      ]);
      const mem = parseWindowsMem(stdout);
      if (!mem) throw new Error("Could not parse Win32_OperatingSystem output");
      return mem;
    },
  };
}
