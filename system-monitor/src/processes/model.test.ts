import { describe, it, expect } from "vitest";
import {
  buildRows,
  buildAggregate,
  computeBadges,
  computeStatusRows,
  formatCpu,
  formatMem,
  displayName,
  groupInfosByWorkspace,
} from "./model";
import type { ProcessesAggregate } from "./model";
import type { ProcessInfo, ProcessTreeNode } from "@silo-code/sdk";

function info(p: Partial<ProcessInfo> & { sessionId: string; pgid: number }): ProcessInfo {
  return {
    workspaceId: "ws1",
    terminalId: `term_${p.sessionId}`,
    terminalTitle: `Terminal ${p.sessionId}`,
    leader: "node",
    cwd: "/repo",
    atPrompt: false,
    ...p,
  };
}

function node(
  pid: number,
  cpuPercent = 0,
  memoryMb = 1,
  children: ProcessTreeNode[] = [],
): ProcessTreeNode {
  return { pid, command: `cmd${pid}`, cpuPercent, memoryMb, children };
}

describe("buildRows", () => {
  it("takes leader cpu/mem from ProcessInfo.stats", () => {
    const infos = [
      info({
        sessionId: "a",
        pgid: 100,
        stats: { pid: 100, cpuPercent: 42, memoryMb: 256 },
      }),
    ];
    const rows = buildRows(infos);
    expect(rows[0].cpuPercent).toBe(42);
    expect(rows[0].memoryMb).toBe(256);
  });

  it("is null cpu/mem before the first stats tick", () => {
    const infos = [info({ sessionId: "a", pgid: 100 })];
    const rows = buildRows(infos);
    expect(rows[0].cpuPercent).toBeNull();
    expect(rows[0].memoryMb).toBeNull();
    expect(rows[0].totalCpuPercent).toBeNull();
    expect(rows[0].totalMemoryMb).toBeNull();
    expect(rows[0].tree).toBeNull();
    expect(rows[0].childCount).toBe(0);
  });

  it("exposes the host-built tree for a busy session", () => {
    const infos = [
      info({
        sessionId: "a",
        pgid: 100,
        atPrompt: false,
        tree: node(100, 0, 1, [node(101)]),
      }),
    ];
    const rows = buildRows(infos);
    expect(rows[0].tree?.children).toHaveLength(1);
    expect(rows[0].childCount).toBe(1);
  });

  it("rolls up leader + descendant cpu/mem into totalCpuPercent/totalMemoryMb", () => {
    const infos = [
      info({
        sessionId: "a",
        pgid: 100,
        atPrompt: false,
        stats: { pid: 100, cpuPercent: 5, memoryMb: 2 },
        tree: node(100, 5, 2, [node(101, 40, 1, [node(102, 30, 0.5)])]),
      }),
    ];
    const rows = buildRows(infos);
    // Leader-only fields are unaffected — used by buildAggregate to avoid
    // double-counting descendants.
    expect(rows[0].cpuPercent).toBe(5);
    expect(rows[0].memoryMb).toBe(2);
    expect(rows[0].totalCpuPercent).toBe(75); // 5 + 40 + 30
    expect(rows[0].totalMemoryMb).toBeCloseTo(3.5); // 2 + 1 + 0.5
  });

  it("equals the leader-only stat when there are no descendants", () => {
    const infos = [
      info({
        sessionId: "a",
        pgid: 100,
        atPrompt: false,
        stats: { pid: 100, cpuPercent: 7, memoryMb: 2 },
        tree: node(100, 7, 2),
      }),
    ];
    const rows = buildRows(infos);
    expect(rows[0].totalCpuPercent).toBe(rows[0].cpuPercent);
    expect(rows[0].totalMemoryMb).toBe(rows[0].memoryMb);
  });

  it("suppresses the tree for atPrompt rows even when the host provides one", () => {
    const infos = [
      info({
        sessionId: "a",
        pgid: 100,
        atPrompt: true,
        leader: "-zsh",
        tree: node(100, 0, 1, [node(101)]),
      }),
    ];
    const rows = buildRows(infos);
    expect(rows[0].tree).toBeNull();
    expect(rows[0].childCount).toBe(0);
  });

  it("renders leaders-only when the host doesn't provide trees", () => {
    const infos = [
      info({
        sessionId: "a",
        pgid: 100,
        atPrompt: false,
        stats: { pid: 100, cpuPercent: 7, memoryMb: 2 },
      }),
    ];
    const rows = buildRows(infos);
    expect(rows[0].tree).toBeNull();
    expect(rows[0].childCount).toBe(0);
    expect(rows[0].totalCpuPercent).toBe(7);
  });

  it("sorts busy sessions before idle sessions, then by title", () => {
    const infos = [
      info({ sessionId: "b", pgid: 200, atPrompt: true, terminalTitle: "B" }),
      info({ sessionId: "a", pgid: 100, atPrompt: false, terminalTitle: "Z" }),
      info({ sessionId: "c", pgid: 300, atPrompt: false, terminalTitle: "A" }),
    ];
    const rows = buildRows(infos);
    expect(rows.map((r) => r.title)).toEqual(["A", "Z", "B"]);
  });

  it("prefers the live terminal title over ProcessInfo.terminalTitle", () => {
    const infos = [info({ sessionId: "a", pgid: 100 })];
    const rows = buildRows(infos, new Map([["term_a", "Live Title"]]));
    expect(rows[0].title).toBe("Live Title");
  });
});

describe("buildAggregate", () => {
  it("sums sessions, procs, cpu, and mem across leaders and children", () => {
    const infos = [
      info({
        sessionId: "a",
        pgid: 100,
        atPrompt: false,
        stats: { pid: 100, cpuPercent: 10, memoryMb: 1 },
        tree: node(100, 10, 1, [node(101, 5, 2)]),
      }),
    ];
    const rows = buildRows(infos);
    const agg = buildAggregate(rows);
    expect(agg.sessions).toBe(1);
    expect(agg.procs).toBe(2);
    expect(agg.cpuPercent).toBe(15);
    expect(agg.memoryMb).toBe(3);
  });

  it("dedupes a child pid appearing in more than one session's tree", () => {
    const infos = [
      info({
        sessionId: "a",
        pgid: 100,
        atPrompt: false,
        tree: node(100, 0, 0, [node(999, 5, 1)]),
      }),
      info({
        sessionId: "b",
        pgid: 200,
        atPrompt: false,
        tree: node(200, 0, 0, [node(999, 5, 1)]),
      }),
    ];
    const rows = buildRows(infos);
    const agg = buildAggregate(rows);
    // 2 leaders + pid 999 counted once.
    expect(agg.procs).toBe(3);
    expect(agg.cpuPercent).toBe(5);
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

describe("groupInfosByWorkspace", () => {
  it("splits a cross-workspace list by workspaceId", () => {
    const infos = [
      info({ sessionId: "a", pgid: 100, workspaceId: "ws1" }),
      info({ sessionId: "b", pgid: 200, workspaceId: "ws2" }),
      info({ sessionId: "c", pgid: 300, workspaceId: "ws1" }),
    ];
    const grouped = groupInfosByWorkspace(infos);
    expect([...grouped.keys()].sort()).toEqual(["ws1", "ws2"]);
    expect(grouped.get("ws1")?.map((i) => i.sessionId)).toEqual(["a", "c"]);
    expect(grouped.get("ws2")?.map((i) => i.sessionId)).toEqual(["b"]);
  });

  it("returns an empty map for an empty list", () => {
    expect(groupInfosByWorkspace([]).size).toBe(0);
  });
});

describe("computeStatusRows", () => {
  it("omits rows below both thresholds", () => {
    const rows = buildRows([
      info({
        sessionId: "a",
        pgid: 100,
        atPrompt: false,
        stats: { pid: 100, cpuPercent: 10, memoryMb: 100 },
      }),
    ]);
    expect(computeStatusRows(rows)).toEqual([]);
  });

  it("flags a warn row between the warn and danger thresholds", () => {
    const rows = buildRows([
      info({
        sessionId: "a",
        pgid: 100,
        atPrompt: false,
        leader: "node",
        stats: { pid: 100, cpuPercent: 40, memoryMb: 100 },
      }),
    ]);
    const [row] = computeStatusRows(rows);
    expect(row.status).toBe("warn");
    expect(row.label).toBe("node: 40% CPU");
  });

  it("flags an error row at or above the danger threshold", () => {
    const rows = buildRows([
      info({
        sessionId: "a",
        pgid: 100,
        atPrompt: false,
        stats: { pid: 100, cpuPercent: 80, memoryMb: 100 },
      }),
    ]);
    expect(computeStatusRows(rows)[0].status).toBe("error");
  });

  it("includes both CPU and memory in the label when both warn", () => {
    const rows = buildRows([
      info({
        sessionId: "a",
        pgid: 100,
        atPrompt: false,
        leader: "node",
        stats: { pid: 100, cpuPercent: 40, memoryMb: 600 },
      }),
    ]);
    expect(computeStatusRows(rows)[0].label).toBe("node: 40% CPU · 600 MB");
  });
});

describe("computeBadges", () => {
  function agg(cpuPercent: number, memoryMb: number): ProcessesAggregate {
    return { sessions: 1, procs: 1, cpuPercent, memoryMb };
  }

  it("returns no badges below both thresholds", () => {
    expect(computeBadges(agg(10, 100))).toEqual([]);
  });

  it("adds a warn-colored CPU badge between thresholds", () => {
    const [badge] = computeBadges(agg(40, 0));
    expect(badge).toMatchObject({ id: "cpu", text: "CPU", color: "#e3b341" });
  });

  it("adds a danger-colored CPU badge at or above the danger threshold", () => {
    const [badge] = computeBadges(agg(80, 0));
    expect(badge.color).toBe("#f47067");
  });

  it("adds both CPU and MEM badges when both cross their thresholds", () => {
    const badges = computeBadges(agg(40, 600));
    expect(badges.map((b) => b.id)).toEqual(["cpu", "mem"]);
  });
});
