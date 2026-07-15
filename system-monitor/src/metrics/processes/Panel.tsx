import { useState } from "react";
import type { LiveData } from "../../store";
import { formatCpu, formatMem } from "../../processes/model";
import { processesController } from "../../processes/controller";
import { SessionRowView } from "./SessionRowView";

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
              onFocus={(r) => r.terminalId && processesController.focusTerminal(r.terminalId)}
              onKill={(r) => void processesController.killSession(r)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
