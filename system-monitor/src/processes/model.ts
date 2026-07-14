// Pure row/aggregate/format model for the Processes panel — no ctx, no I/O.

import type {
  ProcessInfo,
  ProcessTreeNode,
  WorkspaceBadge,
  WorkspaceStatusRow,
} from "@silo-code/sdk";
import { flattenTree } from "./tree";

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
  /** Process tree rooted at this session's leader, from ProcessInfo.tree.
   * Always `null` while `atPrompt` (the leader is the shell itself — nothing
   * to expand or kill), and `null` on hosts too old to provide trees. */
  tree: ProcessTreeNode | null;
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
}

/** Splits a flat, cross-workspace {@link ProcessInfo} list (from
 * `ctx.processes.getState({ allWorkspaces: true })`) by {@link ProcessInfo.workspaceId},
 * so each workspace's badges/status can be computed independently. */
export function groupInfosByWorkspace(
  infos: ProcessInfo[],
): Map<string, ProcessInfo[]> {
  const map = new Map<string, ProcessInfo[]>();
  for (const info of infos) {
    const list = map.get(info.workspaceId);
    if (list) list.push(info);
    else map.set(info.workspaceId, [info]);
  }
  return map;
}

/** One row per session. Trees and stats both come from the host's stats poll
 * (`enableStats({ trees: true })`); rows render leaders-only until the first
 * tick arrives or when the host doesn't support trees. */
export function buildRows(
  infos: ProcessInfo[],
  terminalTitles?: Map<string, string>,
): SessionRow[] {
  const rows: SessionRow[] = infos.map((info) => {
    const cpuPercent = info.stats?.cpuPercent ?? null;
    const memoryMb = info.stats?.memoryMb ?? null;

    const tree = !info.atPrompt && info.tree ? info.tree : null;
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

// ─── Workspace status/badge thresholds ─────────────────────────────────────────
// Shared by any workspace's rows/aggregate — a session or workspace crosses
// "warn" then "error" at the same CPU/memory levels regardless of which
// workspace it lives in.

const CPU_WARN_PERCENT = 25;
const CPU_DANGER_PERCENT = 75;
const MEM_WARN_MB = 500;
const MEM_DANGER_MB = 2000;
const WARN_COLOR = "#e3b341";
const DANGER_COLOR = "#f47067";

/** Per-session warn/error rows for a workspace's Workspaces-panel status list. */
export function computeStatusRows(rows: SessionRow[]): WorkspaceStatusRow[] {
  const result: WorkspaceStatusRow[] = [];
  for (const row of rows) {
    const cpu = row.totalCpuPercent ?? 0;
    const mem = row.totalMemoryMb ?? 0;
    const cpuWarn = cpu >= CPU_WARN_PERCENT;
    const memWarn = mem >= MEM_WARN_MB;
    if (!cpuWarn && !memWarn) continue;

    const status = cpu >= CPU_DANGER_PERCENT || mem >= MEM_DANGER_MB ? "error" : "warn";
    const parts: string[] = [];
    if (cpuWarn) parts.push(`${formatCpu(row.totalCpuPercent)} CPU`);
    if (memWarn) parts.push(formatMem(row.totalMemoryMb));
    result.push({
      id: row.sessionId,
      status,
      label: `${displayName(row.leader)}: ${parts.join(" · ")}`,
    });
  }
  return result;
}

/** CPU/MEM badges for a workspace's aggregate resource usage. */
export function computeBadges(agg: ProcessesAggregate): WorkspaceBadge[] {
  const result: WorkspaceBadge[] = [];
  if (agg.cpuPercent >= CPU_WARN_PERCENT) {
    result.push({
      id: "cpu",
      text: "CPU",
      color: agg.cpuPercent >= CPU_DANGER_PERCENT ? DANGER_COLOR : WARN_COLOR,
    });
  }
  if (agg.memoryMb >= MEM_WARN_MB) {
    result.push({
      id: "mem",
      text: "MEM",
      color: agg.memoryMb >= MEM_DANGER_MB ? DANGER_COLOR : WARN_COLOR,
    });
  }
  return result;
}
