import { useState } from "react";
import type { LiveData } from "../../store";
import type { SessionRow } from "../../processes/model";
import { formatCpu, formatMem, displayName } from "../../processes/model";
import { flattenTree } from "../../processes/tree";
import { processesController } from "../../processes/controller";
import { ChevronIcon, KillIcon } from "../../icons";

function cpuClass(pct: number | null): string {
  if (pct == null) return "sm-proc-stat";
  if (pct >= 75) return "sm-proc-stat sm-proc-stat-danger";
  if (pct >= 25) return "sm-proc-stat sm-proc-stat-warn";
  return "sm-proc-stat";
}

function memClass(mb: number | null): string {
  if (mb == null) return "sm-proc-stat";
  if (mb >= 2000) return "sm-proc-stat sm-proc-stat-danger";
  if (mb >= 500) return "sm-proc-stat sm-proc-stat-warn";
  return "sm-proc-stat";
}

function SessionRowView({
  row,
  expanded,
  onToggle,
}: {
  row: SessionRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasChildren = row.childCount > 0;
  const flat = expanded && row.tree ? flattenTree(row.tree) : [];
  const leaderName = displayName(row.leader);
  const showLeader = leaderName !== row.title;

  return (
    <>
      <div
        className={"sm-proc-row" + (row.terminalId ? " sm-proc-row-clickable" : "")}
        onClick={() => row.terminalId && processesController.focusTerminal(row.terminalId)}
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
          onClick={(e) => { e.stopPropagation(); void processesController.killSession(row); }}
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

export function ProcessesPanel({ live }: { live: LiveData }) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const data = live.processes;
  const rows = data?.rows ?? [];
  const agg = data?.agg;

  function toggle(sessionId: string): void {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  }

  return (
    <div className="sm-card sm-card-processes">
      <div className="sm-header">
        <span className="sm-title">Processes</span>
        <span className="sm-headline">
          {agg
            ? `${agg.procs} proc${agg.procs === 1 ? "" : "s"} · ${formatCpu(agg.cpuPercent)} · ${formatMem(agg.memoryMb)}`
            : "—"}
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="sm-proc-empty">No terminals in this workspace.</div>
      ) : (
        <div className="sm-proc-rows">
          {rows.map((row) => (
            <SessionRowView
              key={row.sessionId}
              row={row}
              expanded={expandedIds.has(row.sessionId)}
              onToggle={() => toggle(row.sessionId)}
            />
          ))}
        </div>
      )}
      {data?.error && <div className="sm-proc-footnote">{data.error}</div>}
    </div>
  );
}
