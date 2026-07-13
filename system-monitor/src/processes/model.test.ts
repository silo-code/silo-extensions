import { describe, it, expect } from "vitest";
import {
  buildRows,
  buildAggregate,
  formatCpu,
  formatMem,
  displayName,
} from "./model";
import type { ProcessInfo } from "@silo-code/sdk";
import type { PsProcess } from "./ps";

function info(p: Partial<ProcessInfo> & { sessionId: string; pgid: number }): ProcessInfo {
  return {
    terminalId: `term_${p.sessionId}`,
    terminalTitle: `Terminal ${p.sessionId}`,
    leader: "node",
    cwd: "/repo",
    atPrompt: false,
    ...p,
  };
}

function ps(p: Partial<PsProcess> & { pid: number; ppid: number }): PsProcess {
  return {
    pgid: p.pid,
    rssKb: 1024,
    cpuPercent: 0,
    command: `cmd${p.pid}`,
    ...p,
  };
}

describe("buildRows", () => {
  it("prefers ProcessInfo.stats over ps for leader cpu/mem", () => {
    const infos = [
      info({
        sessionId: "a",
        pgid: 100,
        stats: { pid: 100, cpuPercent: 42, memoryMb: 256 },
      }),
    ];
    const psRows = [ps({ pid: 100, ppid: 1, cpuPercent: 5, rssKb: 4096 })];
    const rows = buildRows(infos, psRows);
    expect(rows[0].cpuPercent).toBe(42);
    expect(rows[0].memoryMb).toBe(256);
  });

  it("falls back to the leader's ps row when stats are absent", () => {
    const infos = [info({ sessionId: "a", pgid: 100 })];
    const psRows = [ps({ pid: 100, ppid: 1, cpuPercent: 7, rssKb: 2048 })];
    const rows = buildRows(infos, psRows);
    expect(rows[0].cpuPercent).toBe(7);
    expect(rows[0].memoryMb).toBe(2);
  });

  it("is null cpu/mem when neither stats nor ps (Windows) are available", () => {
    const infos = [info({ sessionId: "a", pgid: 100 })];
    const rows = buildRows(infos, null);
    expect(rows[0].cpuPercent).toBeNull();
    expect(rows[0].memoryMb).toBeNull();
    expect(rows[0].totalCpuPercent).toBeNull();
    expect(rows[0].totalMemoryMb).toBeNull();
    expect(rows[0].tree).toBeNull();
    expect(rows[0].childCount).toBe(0);
  });

  it("builds a tree for a busy session when ps is available", () => {
    const infos = [info({ sessionId: "a", pgid: 100, atPrompt: false })];
    const psRows = [
      ps({ pid: 100, ppid: 1 }),
      ps({ pid: 101, ppid: 100 }),
    ];
    const rows = buildRows(infos, psRows);
    expect(rows[0].tree?.children).toHaveLength(1);
    expect(rows[0].childCount).toBe(1);
  });

  it("rolls up leader + descendant cpu/mem into totalCpuPercent/totalMemoryMb", () => {
    const infos = [info({ sessionId: "a", pgid: 100, atPrompt: false })];
    const psRows = [
      ps({ pid: 100, ppid: 1, cpuPercent: 5, rssKb: 2048 }), // leader: 5%, 2 MB
      ps({ pid: 101, ppid: 100, cpuPercent: 40, rssKb: 1024 }), // child: 40%, 1 MB
      ps({ pid: 102, ppid: 101, cpuPercent: 30, rssKb: 512 }), // grandchild: 30%, 0.5 MB
    ];
    const rows = buildRows(infos, psRows);
    // Leader-only fields are unaffected — used by buildAggregate to avoid
    // double-counting descendants.
    expect(rows[0].cpuPercent).toBe(5);
    expect(rows[0].memoryMb).toBe(2);
    expect(rows[0].totalCpuPercent).toBe(75); // 5 + 40 + 30
    expect(rows[0].totalMemoryMb).toBeCloseTo(3.5); // 2 + 1 + 0.5
  });

  it("equals the leader-only stat when there are no descendants", () => {
    const infos = [info({ sessionId: "a", pgid: 100, atPrompt: false })];
    const psRows = [ps({ pid: 100, ppid: 1, cpuPercent: 7, rssKb: 2048 })];
    const rows = buildRows(infos, psRows);
    expect(rows[0].totalCpuPercent).toBe(rows[0].cpuPercent);
    expect(rows[0].totalMemoryMb).toBe(rows[0].memoryMb);
  });

  it("suppresses the tree for atPrompt rows even when ps has children", () => {
    const infos = [info({ sessionId: "a", pgid: 100, atPrompt: true, leader: "-zsh" })];
    const psRows = [
      ps({ pid: 100, ppid: 1 }),
      ps({ pid: 101, ppid: 100 }),
    ];
    const rows = buildRows(infos, psRows);
    expect(rows[0].tree).toBeNull();
    expect(rows[0].childCount).toBe(0);
  });

  it("sorts busy sessions before idle sessions, then by title", () => {
    const infos = [
      info({ sessionId: "b", pgid: 200, atPrompt: true, terminalTitle: "B" }),
      info({ sessionId: "a", pgid: 100, atPrompt: false, terminalTitle: "Z" }),
      info({ sessionId: "c", pgid: 300, atPrompt: false, terminalTitle: "A" }),
    ];
    const rows = buildRows(infos, null);
    expect(rows.map((r) => r.title)).toEqual(["A", "Z", "B"]);
  });
});

describe("buildAggregate", () => {
  it("sums sessions, procs, cpu, and mem across leaders and children", () => {
    const infos = [info({ sessionId: "a", pgid: 100, atPrompt: false })];
    const psRows = [
      ps({ pid: 100, ppid: 1, cpuPercent: 10, rssKb: 1024 }),
      ps({ pid: 101, ppid: 100, cpuPercent: 5, rssKb: 2048 }),
    ];
    const rows = buildRows(infos, psRows);
    const agg = buildAggregate(rows);
    expect(agg.sessions).toBe(1);
    expect(agg.procs).toBe(2);
    expect(agg.cpuPercent).toBe(15);
    expect(agg.memoryMb).toBe(3);
  });

  it("dedupes a child pid unioned into more than one session's tree", () => {
    const infos = [
      info({ sessionId: "a", pgid: 100, atPrompt: false }),
      info({ sessionId: "b", pgid: 200, atPrompt: false }),
    ];
    // pid 999 shares pgid with neither leader via ppid, but both leaders'
    // trees would union it in if both pgids matched — force via same pgid.
    const psRows = [
      ps({ pid: 100, ppid: 1 }),
      ps({ pid: 200, ppid: 1 }),
      ps({ pid: 999, ppid: 5000, pgid: 100 }),
    ];
    const rows = buildRows(infos, psRows);
    const agg = buildAggregate(rows);
    // pid 999 only unions into session a's tree (pgid 100), not b's.
    expect(agg.procs).toBe(3);
  });
});

describe("formatCpu", () => {
  it("formats null as an em dash", () => expect(formatCpu(null)).toBe("—"));
  it("rounds to whole percent", () => expect(formatCpu(41.6)).toBe("42%"));
});

describe("formatMem", () => {
  it("formats null as an em dash", () => expect(formatMem(null)).toBe("—"));
  it("formats sub-GB as whole MB", () => expect(formatMem(512)).toBe("512 MB"));
  it("formats >=1024MB as GB with one decimal", () =>
    expect(formatMem(1434)).toBe("1.4 GB"));
});

describe("displayName", () => {
  it("returns the basename of a path", () =>
    expect(displayName("/usr/bin/node")).toBe("node"));
  it("strips the leading - of a login shell", () =>
    expect(displayName("-zsh")).toBe("zsh"));
  it("passes through a bare command unchanged", () =>
    expect(displayName("node")).toBe("node"));
});
