import { describe, it, expect } from "vitest";
import { flattenTree } from "./tree";
import type { ProcessTreeNode } from "@silo-code/sdk";

function node(pid: number, children: ProcessTreeNode[] = []): ProcessTreeNode {
  return { pid, command: `cmd${pid}`, cpuPercent: 0, memoryMb: 1, children };
}

describe("flattenTree", () => {
  it("returns an empty list for a leaf root", () => {
    expect(flattenTree(node(1))).toEqual([]);
  });

  it("excludes the root and records depth per descendant", () => {
    const root = node(1, [node(2, [node(3)]), node(4)]);
    const flat = flattenTree(root);
    expect(flat.map(({ node: n, depth }) => [n.pid, depth])).toEqual([
      [2, 0],
      [3, 1],
      [4, 0],
    ]);
  });

  it("preserves pre-order across siblings with nested children", () => {
    const root = node(1, [node(2, [node(5), node(6)]), node(3, [node(7)])]);
    expect(flattenTree(root).map(({ node: n }) => n.pid)).toEqual([
      2, 5, 6, 3, 7,
    ]);
  });
});
