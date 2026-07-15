// One session's row (plus its expanded descendant rows) — shared between the
// Processes side-panel card and the all-workspaces processes modal, which wire
// focus/kill differently (the modal has to activate the row's workspace first).

import type { SessionRow } from "../../processes/model";
import { formatCpu, formatMem, displayName } from "../../processes/model";
import { flattenTree } from "../../processes/tree";
import { ChevronIcon, KillIcon } from "../../icons";

export function cpuClass(pct: number | null): string {
  if (pct == null) return "sm-proc-stat";
  if (pct >= 75) return "sm-proc-stat sm-proc-stat-danger";
  if (pct >= 25) return "sm-proc-stat sm-proc-stat-warn";
  return "sm-proc-stat";
}

export function memClass(mb: number | null): string {
  if (mb == null) return "sm-proc-stat";
  if (mb >= 2000) return "sm-proc-stat sm-proc-stat-danger";
  if (mb >= 500) return "sm-proc-stat sm-proc-stat-warn";
  return "sm-proc-stat";
}

export function SessionRowView({
  row,
  expanded,
  onToggle,
  onFocus,
  onKill,
}: {
  row: SessionRow;
  expanded: boolean;
  onToggle: () => void;
  /** Row click — only wired (and styled clickable) when the row has a terminal. */
  onFocus: (row: SessionRow) => void;
  onKill: (row: SessionRow) => void;
}) {
  const hasChildren = row.childCount > 0;
  const flat = expanded && row.tree ? flattenTree(row.tree) : [];
  const leaderName = displayName(row.leader);
  const showLeader = leaderName !== row.title;

  return (
    <>
      <div
        className={"sm-proc-row" + (row.terminalId ? " sm-proc-row-clickable" : "")}
        onClick={() => row.terminalId && onFocus(row)}
      >
        {hasChildren ? (
          <button
            className="sm-proc-chevron"
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            <span
              className={
                "sm-proc-chevron-glyph" +
                (expanded ? " sm-proc-chevron-open" : "")
              }
            >
              <ChevronIcon />
            </span>
          </button>
        ) : (
          <span className="sm-proc-leaf-dot" aria-hidden />
        )}
        <span className="sm-proc-title">
          <span className="sm-proc-title-text">
            {row.title}
            {hasChildren && (
              <span className="sm-proc-child-count"> ({row.childCount})</span>
            )}
          </span>
          {row.atPrompt && <span className="sm-proc-idle-pill">idle</span>}
        </span>
        <span className="sm-proc-leader">{showLeader && !row.atPrompt ? leaderName : ""}</span>
        <span className={cpuClass(row.totalCpuPercent)}>{formatCpu(row.totalCpuPercent)}</span>
        <span className={memClass(row.totalMemoryMb)}>{formatMem(row.totalMemoryMb)}</span>
        <button
          className="sm-proc-kill"
          onClick={(e) => { e.stopPropagation(); onKill(row); }}
        >
          <KillIcon />
        </button>
      </div>
      {flat.map(({ node, depth }) => (
        <div
          key={node.pid}
          className="sm-proc-child-row"
          style={{ paddingLeft: 26 + depth * 14 }}
        >
          <span className="sm-proc-child-name">{displayName(node.command)}</span>
          <span className={cpuClass(node.cpuPercent)}>{formatCpu(node.cpuPercent)}</span>
          <span className={memClass(node.memoryMb)}>{formatMem(node.memoryMb)}</span>
        </div>
      ))}
    </>
  );
}
