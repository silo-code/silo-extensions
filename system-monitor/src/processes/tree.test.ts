import { describe, it, expect } from "vitest";
import { buildSessionTree, flattenTree } from "./tree";
import type { PsProcess } from "./ps";

function proc(p: Partial<PsProcess> & { pid: number; ppid: number }): PsProcess {
  return {
    pgid: p.pid,
    rssKb: 1024,
    cpuPercent: 0,
    command: `cmd${p.pid}`,
    ...p,
  };
}

describe("buildSessionTree", () => {
  it("returns null when the leader is missing from the snapshot", () => {
    expect(buildSessionTree([proc({ pid: 2, ppid: 1 })], 1)).toBeNull();
  });

  it("builds a single-node tree for a leader with no children", () => {
    const tree = buildSessionTree([proc({ pid: 1, ppid: 0 })], 1);
    expect(tree).toMatchObject({ pid: 1, children: [] });
  });

  it("attaches direct children and grandchildren", () => {
    const all = [
      proc({ pid: 1, ppid: 0 }),
      proc({ pid: 2, ppid: 1 }),
      proc({ pid: 3, ppid: 2 }),
    ];
    const tree = buildSessionTree(all, 1)!;
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].pid).toBe(2);
    expect(tree.children[0].children[0].pid).toBe(3);
  });

  it("converts rssKb to memoryMb", () => {
    const tree = buildSessionTree([proc({ pid: 1, ppid: 0, rssKb: 2048 })], 1)!;
    expect(tree.memoryMb).toBe(2);
  });

  it("unions in double-forked orphans sharing the leader's pgid", () => {
    const all = [
      proc({ pid: 1, ppid: 0 }),
      // Orphaned grandchild: original parent (pid 2) exited, re-parented to
      // pid 1 (init-like) but keeps the session's pgid.
      proc({ pid: 4, ppid: 1, pgid: 1 }),
    ];
    // pid 4 is reachable via ppid too in this setup, so use a ppid that is NOT
    // the leader and not present in the snapshot to force pgid-only reachability.
    const orphaned = [
      proc({ pid: 1, ppid: 0 }),
      proc({ pid: 4, ppid: 999, pgid: 1 }),
    ];
    const tree = buildSessionTree(orphaned, 1)!;
    expect(tree.children.map((c) => c.pid)).toEqual([4]);
  });

  it("does not double-attach a process reachable both via ppid and pgid union", () => {
    const all = [
      proc({ pid: 1, ppid: 0 }),
      proc({ pid: 2, ppid: 1, pgid: 1 }),
    ];
    const tree = buildSessionTree(all, 1)!;
    expect(tree.children).toHaveLength(1);
  });

  it("guards against cycles from corrupted/duplicate ps rows", () => {
    const all = [
      proc({ pid: 1, ppid: 0 }),
      proc({ pid: 2, ppid: 1 }),
      proc({ pid: 3, ppid: 2 }),
      // Corrupted duplicate row claims pid 2 is also a child of pid 3 —
      // without a visited guard this would recurse forever.
      proc({ pid: 2, ppid: 3 }),
    ];
    const tree = buildSessionTree(all, 1)!;
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].pid).toBe(2);
    expect(tree.children[0].children).toHaveLength(1);
    expect(tree.children[0].children[0].children).toHaveLength(0);
  });

  it("ignores self-parented rows (pid === ppid)", () => {
    const all = [proc({ pid: 1, ppid: 1 })];
    const tree = buildSessionTree(all, 1)!;
    expect(tree.children).toHaveLength(0);
  });
});

describe("flattenTree", () => {
  it("flattens pre-order, excluding the root, with correct depths", () => {
    const all = [
      proc({ pid: 1, ppid: 0 }),
      proc({ pid: 2, ppid: 1 }),
      proc({ pid: 3, ppid: 2 }),
      proc({ pid: 4, ppid: 1 }),
    ];
    const tree = buildSessionTree(all, 1)!;
    const flat = flattenTree(tree);
    expect(flat.map((f) => [f.node.pid, f.depth])).toEqual([
      [2, 0],
      [3, 1],
      [4, 0],
    ]);
  });

  it("returns an empty array for a leaf tree", () => {
    const tree = buildSessionTree([proc({ pid: 1, ppid: 0 })], 1)!;
    expect(flattenTree(tree)).toEqual([]);
  });
});
