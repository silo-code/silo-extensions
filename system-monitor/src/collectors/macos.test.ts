import { describe, it, expect } from "vitest";
import { parseIostatOutput, parseVmStatOutput } from "./macos";
import type { MemReading } from "./types";

// ── iostat fixtures ───────────────────────────────────────────────────────────

const IOSTAT_SAMPLE = `
              disk0       cpu    load average
    KB/t  tps  MB/s  us sy id   1m   5m   15m
   25.69  944 23.68  20 11 70  6.96 6.78 7.05
    9.88 1753 16.91  38 21 42  6.96 6.78 7.05
`.trim();

describe("parseIostatOutput", () => {
  it("reads user and sys from the last data row", () => {
    const r = parseIostatOutput(IOSTAT_SAMPLE);
    expect(r?.user).toBe(38);
    expect(r?.sys).toBe(21);
  });

  it("caps user at 100, leaves sys unchanged if under 100", () => {
    const mangled = IOSTAT_SAMPLE.replace(/38 21 42/, "120 90 0");
    const r = parseIostatOutput(mangled);
    expect(r?.user).toBe(100); // 120 → capped
    expect(r?.sys).toBe(90); // 90 → unchanged
  });

  it("returns null for empty / unrecognised output", () => {
    expect(parseIostatOutput("")).toBeNull();
    expect(parseIostatOutput("hello world")).toBeNull();
  });
});

// ── vm_stat fixtures ──────────────────────────────────────────────────────────

// 32 GiB machine, 16 384 byte pages (Apple Silicon)
const VM_STAT_SAMPLE = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                     3763.
Pages active:                                 386314.
Pages inactive:                               383047.
Pages speculative:                              1870.
Pages throttled:                                   0.
Pages wired down:                             266484.
Pages purgeable:                                 226.
"Translation faults":                     5174295619.
Pages copy-on-write:                      1348688691.
Pages zero filled:                        2551763394.
Pages reactivated:                         603652994.
Pages purged:                              120702353.
File-backed pages:                            261298.
Anonymous pages:                              509933.
Pages stored in compressor:                  4527274.
Pages occupied by compressor:                1015753.
Decompressions:                            523236597.
Compressions:                              603164805.
Pageins:                                   200958310.
Pageouts:                                    2459611.
Swapins:                                     9223720.
Swapouts:                                   11713270.
34359738368`;

const PAGE = 16384;
const TOTAL_RAM = 34359738368;
const ANON_PAGES = 509933;
const WIRED_PAGES = 266484;
const COMP_PAGES = 1015753;
const COMMITTED = (ANON_PAGES + WIRED_PAGES + COMP_PAGES) * PAGE;

function seg(r: MemReading | null, label: string): number {
  return r?.segments.find((s) => s.label === label)?.bytes ?? -1;
}

describe("parseVmStatOutput", () => {
  it("reads total RAM from the last line", () => {
    expect(parseVmStatOutput(VM_STAT_SAMPLE)?.totalBytes).toBe(TOTAL_RAM);
  });

  it("App segment uses Anonymous pages (not Pages active)", () => {
    expect(seg(parseVmStatOutput(VM_STAT_SAMPLE), "App")).toBe(
      ANON_PAGES * PAGE,
    );
  });

  it("Wired segment uses wired pages", () => {
    expect(seg(parseVmStatOutput(VM_STAT_SAMPLE), "Wired")).toBe(
      WIRED_PAGES * PAGE,
    );
  });

  it("Cache segment uses occupied (not stored) compressor pages", () => {
    expect(seg(parseVmStatOutput(VM_STAT_SAMPLE), "Cache")).toBe(
      COMP_PAGES * PAGE,
    );
  });

  it("Free segment is the residual: total - wired - app - compressed", () => {
    expect(seg(parseVmStatOutput(VM_STAT_SAMPLE), "Free")).toBe(
      TOTAL_RAM - COMMITTED,
    );
  });

  it("used = wired + app + compressed, and segments sum to total", () => {
    const r = parseVmStatOutput(VM_STAT_SAMPLE);
    expect(r?.usedBytes).toBe(COMMITTED);
    const sum = r!.segments.reduce((a, s) => a + s.bytes, 0);
    expect(sum).toBe(TOTAL_RAM);
    expect((r?.usedBytes ?? 0) + seg(r, "Free")).toBe(TOTAL_RAM);
  });

  it("returns null when the sysctl total line is missing", () => {
    const noSysctl = VM_STAT_SAMPLE.split("\n").slice(0, -1).join("\n");
    expect(parseVmStatOutput(noSysctl)).toBeNull();
  });
});
