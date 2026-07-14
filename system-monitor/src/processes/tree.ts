// Pure tree flattening for indented rendering — no ctx, no I/O. The trees
// themselves are built host-side (enableStats({ trees: true })) and arrive on
// ProcessInfo.tree.

import type { ProcessTreeNode } from "@silo-code/sdk";

/** Pre-order flatten, root excluded, for indented rendering. */
export function flattenTree(
  root: ProcessTreeNode,
): { node: ProcessTreeNode; depth: number }[] {
  const out: { node: ProcessTreeNode; depth: number }[] = [];
  function walk(node: ProcessTreeNode, depth: number): void {
    for (const child of node.children) {
      out.push({ node: child, depth });
      walk(child, depth + 1);
    }
  }
  walk(root, 0);
  return out;
}
