// Pure row/aggregate/format model for the Processes panel — no ctx, no I/O.

import type { ProcessInfo } from "@silo-code/sdk";
import type { PsProcess } from "./ps";
import { buildSessionTree, flattenTree } from "./tree";
import type { ProcNode } from "./tree";

export interface SessionRow {
  sessionId: string;
  terminalId?: string;
  title: string;
  leader: string;
  pgid: number;
  cwd: string;
  atPrompt: boolean;
  /** The leader process's own cpu/mem, independent of any children. */
  cpuPercent: number | null;
  memoryMb: number | null;
  /**
   * Leader + all descendants summed. Use this for the collapsed row's
   * headline stat — the leader alone is often a shell/wrapper that reads
   * near-zero while the real work happens in its children. Equals
   * `cpuPercent` / `memoryMb` when there are no descendants.
   */
  totalCpuPercent: number | null;
  totalMemoryMb: number | null;
  /** Process tree rooted at this session's leader. Always `null` while
   * `atPrompt` (the leader is the shell itself — nothing to expand or kill). */
  tree: ProcNode | null;
  /** Total flattened descendant count (all depths); 0 when `tree` is null. */
  childCount: number;
}

export interface ProcessesAggregate {
  sessions: number;
  procs: number;
  cpuPercent: number;
  memoryMb: number;
}

export interface ProcessesData {
  rows: SessionRow[];
  agg: ProcessesAggregate;
  treesSupported: boolean;
  error: string | null;
}

/** One row per session. `ps` is `null` in degraded mode (parse failure, or
 * Windows where trees aren't supported) — leaders still render from `infos`. */
export function buildRows(
  infos: ProcessInfo[],
  ps: PsProcess[] | null,
  terminalTitles?: Map<string, string>,
): SessionRow[] {
  const rows: SessionRow[] = infos.map((info) => {
    let cpuPercent: number | null = null;
    let memoryMb: number | null = null;
    if (info.stats) {
      cpuPercent = info.stats.cpuPercent;
      memoryMb = info.stats.memoryMb;
    } else if (ps) {
      const leaderPs = ps.find((p) => p.pid === info.pgid);
      if (leaderPs) {
        cpuPercent = leaderPs.cpuPercent;
        memoryMb = leaderPs.rssKb / 1024;
      }
    }

    const tree = !info.atPrompt && ps ? buildSessionTree(ps, info.pgid) : null;
    const descendants = tree ? flattenTree(tree) : [];

    let totalCpuPercent = cpuPercent;
    let totalMemoryMb = memoryMb;
    if (descendants.length > 0) {
      totalCpuPercent =
        (cpuPercent ?? 0) +
        descendants.reduce((sum, { node }) => sum + node.cpuPercent, 0);
      totalMemoryMb =
        (memoryMb ?? 0) +
        descendants.reduce((sum, { node }) => sum + node.memoryMb, 0);
    }

    return {
      sessionId: info.sessionId,
      terminalId: info.terminalId,
      title: (info.terminalId && terminalTitles?.get(info.terminalId)) ?? info.terminalTitle ?? info.leader,
      leader: info.leader,
      pgid: info.pgid,
      cwd: info.cwd,
      atPrompt: info.atPrompt,
      cpuPercent,
      memoryMb,
      totalCpuPercent,
      totalMemoryMb,
      tree,
      childCount: descendants.length,
    };
  });

  return rows.sort((a, b) => {
    if (a.atPrompt !== b.atPrompt) return a.atPrompt ? 1 : -1;
    return a.title.localeCompare(b.title);
  });
}

/** Sums leader + descendant stats, deduping descendant pids across sessions
 * (a double-forked orphan could in principle be unioned into more than one
 * session's tree). */
export function buildAggregate(rows: SessionRow[]): ProcessesAggregate {
  const seenChildPids = new Set<number>();
  let procs = rows.length;
  let cpuPercent = 0;
  let memoryMb = 0;

  for (const row of rows) {
    if (row.cpuPercent != null) cpuPercent += row.cpuPercent;
    if (row.memoryMb != null) memoryMb += row.memoryMb;
    if (!row.tree) continue;

    for (const { node } of flattenTree(row.tree)) {
      if (seenChildPids.has(node.pid)) continue;
      seenChildPids.add(node.pid);
      procs += 1;
      cpuPercent += node.cpuPercent;
      memoryMb += node.memoryMb;
    }
  }

  return { sessions: rows.length, procs, cpuPercent, memoryMb };
}

export function formatCpu(pct: number | null): string {
  if (pct == null) return "—";
  return `${Math.round(pct)}%`;
}

export function formatMem(mb: number | null): string {
  if (mb == null) return "—";
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

/** Basename of a command path, with the leading `-` of a login shell
 * (e.g. `-zsh`) stripped. */
export function displayName(command: string): string {
  const base = command.slice(command.lastIndexOf("/") + 1);
  return base.startsWith("-") ? base.slice(1) : base;
}
