import { useState } from "react";
import type { LiveData } from "../../store";
import type { SessionRow } from "../../processes/model";
import { formatCpu, formatMem, displayName } from "../../processes/model";
import { flattenTree } from "../../processes/tree";
import { processesController } from "../../processes/controller";
import { ChevronIcon, KillIcon } from "../../icons";

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
  // The leader is often exactly the tab title (an un-renamed "node"/"npm"
  // terminal, or — while idle — the shell itself), so repeat it only when it
  // adds information beyond the title.
  const showLeader = leaderName !== row.title;

  return (
    <>
      <div
        className={
          "sm-proc-row" + (row.atPrompt ? " sm-proc-row-idle" : "")
        }
      >
        {hasChildren ? (
          <button
            className="sm-proc-chevron"
            onClick={onToggle}
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
          // Placeholder where the chevron would go, so leaf rows still line
          // up with expandable ones instead of leaving a blank gap.
          <span className="sm-proc-leaf-dot" aria-hidden />
        )}
        <button
          className="sm-proc-title"
          onClick={() =>
            row.terminalId && processesController.focusTerminal(row.terminalId)
          }
          disabled={!row.terminalId}
          title={row.cwd || undefined}
        >
          {row.title}
          {hasChildren && (
            <span className="sm-proc-child-count"> ({row.childCount})</span>
          )}
        </button>
        {row.atPrompt ? (
          // The leader is always the shell while idle — same as the title,
          // so showing it again would just repeat "zsh … zsh". Show the
          // idle pill in its place instead.
          <span className="sm-proc-idle-pill">idle</span>
        ) : (
          <>
            <span className="sm-proc-leader">{showLeader ? leaderName : ""}</span>
            <span className="sm-proc-stat">{formatCpu(row.totalCpuPercent)}</span>
            <span className="sm-proc-stat">{formatMem(row.totalMemoryMb)}</span>
            <button
              className="sm-proc-kill"
              title="Kill process group"
              onClick={() => void processesController.killSession(row)}
            >
              <KillIcon />
            </button>
          </>
        )}
      </div>
      {flat.map(({ node, depth }) => (
        <div
          key={node.pid}
          className="sm-proc-child-row"
          style={{ paddingLeft: 26 + depth * 14 }}
        >
          <span className="sm-proc-child-name">{displayName(node.command)}</span>
          <span className="sm-proc-stat">{formatCpu(node.cpuPercent)}</span>
          <span className="sm-proc-stat">{formatMem(node.memoryMb)}</span>
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
