// Pure process-tree building from a flat `ps` snapshot — no ctx, no I/O.

import type { PsProcess } from "./ps";

export interface ProcNode {
  pid: number;
  command: string;
  cpuPercent: number;
  memoryMb: number;
  children: ProcNode[];
}

function toNode(p: PsProcess): ProcNode {
  return {
    pid: p.pid,
    command: p.command,
    cpuPercent: p.cpuPercent,
    memoryMb: p.rssKb / 1024,
    children: [],
  };
}

/**
 * Build the process tree rooted at `leaderPid` — BFS over ppid edges from a
 * flat ps snapshot, unioned with any process sharing the leader's pgid that
 * isn't reachable via ppid (double-forked orphans re-parented to init/launchd).
 * Returns `null` if the leader isn't in `all` (it exited between ticks — the
 * caller should render leaders-only for that one tick).
 */
export function buildSessionTree(
  all: PsProcess[],
  leaderPid: number,
): ProcNode | null {
  const leader = all.find((p) => p.pid === leaderPid);
  if (!leader) return null;

  const childrenByPpid = new Map<number, PsProcess[]>();
  for (const p of all) {
    if (p.pid === p.ppid) continue; // self-parented roots (pid 0/1) — never a child
    const list = childrenByPpid.get(p.ppid);
    if (list) list.push(p);
    else childrenByPpid.set(p.ppid, [p]);
  }

  const root = toNode(leader);
  const visited = new Set<number>([leader.pid]);
  const nodeByPid = new Map<number, ProcNode>([[leader.pid, root]]);

  // BFS over ppid edges, guarding against revisiting a pid (corrupt/duplicate
  // ps rows could otherwise loop forever).
  let frontier = [leader.pid];
  while (frontier.length > 0) {
    const next: number[] = [];
    for (const parentPid of frontier) {
      const parentNode = nodeByPid.get(parentPid);
      if (!parentNode) continue;
      for (const kid of childrenByPpid.get(parentPid) ?? []) {
        if (visited.has(kid.pid)) continue;
        visited.add(kid.pid);
        const kidNode = toNode(kid);
        parentNode.children.push(kidNode);
        nodeByPid.set(kid.pid, kidNode);
        next.push(kid.pid);
      }
    }
    frontier = next;
  }

  // Union in double-forked orphans: same pgid as the leader but never reached
  // via a ppid edge (re-parented to init/launchd once their original parent exited).
  for (const p of all) {
    if (p.pgid === leaderPid && !visited.has(p.pid)) {
      visited.add(p.pid);
      root.children.push(toNode(p));
    }
  }

  return root;
}

/** Pre-order flatten, root excluded, for indented rendering. */
export function flattenTree(root: ProcNode): { node: ProcNode; depth: number }[] {
  const out: { node: ProcNode; depth: number }[] = [];
  function walk(node: ProcNode, depth: number): void {
    for (const child of node.children) {
      out.push({ node: child, depth });
      walk(child, depth + 1);
    }
  }
  walk(root, 0);
  return out;
}
