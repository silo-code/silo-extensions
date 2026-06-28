import { Tooltip } from "@silo-code/sdk";
import type { LiveData } from "../../store";
import { segmentTooltip } from "./tooltip";

export function MemStatus({ live }: { live: LiveData }) {
  const data = live.memory;
  const pct = data
    ? Math.round((data.usedBytes / data.totalBytes) * 100)
    : null;
  const tip = data ? segmentTooltip(data) : "Waiting for data…";
  return (
    <Tooltip content={tip}>
      <div className="sm-status-item">
        MEM{" "}
        <span className="sm-status-val">{pct != null ? `${pct}%` : "—"}</span>
      </div>
    </Tooltip>
  );
}
