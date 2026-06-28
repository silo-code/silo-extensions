import { describe, it, expect } from "vitest";
import { parseProcStat, cpuDelta, parseMeminfo } from "./linux";
import type { MemReading } from "./types";

const KB = 1024;

// ── /proc/stat ────────────────────────────────────────────────────────────────

describe("parseProcStat", () => {
  it("aggregates user(+nice) and sys(+irq+softirq) and sums total", () => {
    // cpu user nice system idle iowait irq softirq steal guest guest_nice
    const r = parseProcStat("cpu  10 20 30 40 50 60 70 0 0 0\ncpu0 1 1 1 1");
    expect(r).toEqual({
      user: 10 + 20,
      sys: 30 + 60 + 70,
      total: 10 + 20 + 30 + 40 + 50 + 60 + 70,
    });
  });

  it("tolerates a short line missing irq/softirq", () => {
    const r = parseProcStat("cpu 100 0 50 200");
    expect(r).toEqual({ user: 100, sys: 50, total: 350 });
  });

  it("returns null when there is no cpu line", () => {
    expect(parseProcStat("intr 123\nctxt 456")).toBeNull();
    expect(parseProcStat("")).toBeNull();
  });
});

describe("cpuDelta", () => {
  it("computes user/sys percentages from two snapshots", () => {
    const prev = { user: 30, sys: 160, total: 280 };
    const cur = { user: 230, sys: 260, total: 1280 }; // Δ: 200 user, 100 sys, 1000 total
    expect(cpuDelta(prev, cur)).toEqual({ user: 20, sys: 10 });
  });

  it("returns null when no time elapsed (Δtotal <= 0)", () => {
    const s = { user: 1, sys: 1, total: 100 };
    expect(cpuDelta(s, s)).toBeNull();
  });

  it("clamps to 0–100", () => {
    const prev = { user: 0, sys: 0, total: 0 };
    const cur = { user: 500, sys: 0, total: 100 }; // absurd Δuser > Δtotal
    expect(cpuDelta(prev, cur)).toEqual({ user: 100, sys: 0 });
  });
});

// ── /proc/meminfo ─────────────────────────────────────────────────────────────

const MEMINFO = `MemTotal:       32000000 kB
MemFree:         2000000 kB
MemAvailable:   20000000 kB
Buffers:          500000 kB
Cached:          8000000 kB
SReclaimable:     800000 kB
SwapTotal:       4000000 kB`;

function seg(r: MemReading | null, label: string): number {
  return r?.segments.find((s) => s.label === label)?.bytes ?? -1;
}

describe("parseMeminfo", () => {
  it("uses MemAvailable for the used/free split", () => {
    const r = parseMeminfo(MEMINFO);
    expect(r?.totalBytes).toBe(32000000 * KB);
    expect(r?.usedBytes).toBe((32000000 - 20000000) * KB);
    expect(seg(r, "Used")).toBe((32000000 - 20000000) * KB);
    expect(seg(r, "Cache")).toBe((20000000 - 2000000) * KB); // available - free
    expect(seg(r, "Free")).toBe(2000000 * KB);
  });

  it("segments sum to total", () => {
    const r = parseMeminfo(MEMINFO);
    const sum = r!.segments.reduce((a, s) => a + s.bytes, 0);
    expect(sum).toBe(32000000 * KB);
  });

  it("falls back to free+buffers+cached+sreclaimable when MemAvailable absent", () => {
    const noAvail = MEMINFO.split("\n")
      .filter((l) => !l.startsWith("MemAvailable"))
      .join("\n");
    const r = parseMeminfo(noAvail);
    const available = (2000000 + 500000 + 8000000 + 800000) * KB;
    expect(r?.usedBytes).toBe(32000000 * KB - available);
    expect(seg(r, "Free")).toBe(2000000 * KB);
  });

  it("returns null when MemTotal is missing", () => {
    expect(parseMeminfo("MemFree: 100 kB")).toBeNull();
  });
});
