import type React from "react";
import { formatBytes } from "../../metrics";
import type { LiveData } from "../../store";

interface DonutSegment {
  pct: number;
  color: string;
}

function DonutRing({
  segments,
  size,
  center,
}: {
  segments: DonutSegment[];
  size: number;
  center: React.ReactNode;
}) {
  const sw = Math.round(size / 8);
  const r = (size - sw) / 2;
  const cx = size / 2;
  const C = 2 * Math.PI * r;
  let cum = 0;

  return (
    <div
      style={{ position: "relative", width: size, height: size, flexShrink: 0 }}
    >
      <svg
        width={size}
        height={size}
        style={{ position: "absolute", inset: 0 }}
        aria-hidden
      >
        <circle
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          stroke="var(--silo-color-border)"
          strokeWidth={sw}
        />
        {segments.map((seg, i) => {
          if (seg.pct < 0.3) {
            cum += seg.pct;
            return null;
          }
          const dash = (seg.pct / 100) * C;
          const gap = C - dash;
          const angle = (cum / 100) * 360 - 90;
          cum += seg.pct;
          return (
            <circle
              key={i}
              cx={cx}
              cy={cx}
              r={r}
              fill="none"
              stroke={seg.color}
              strokeWidth={sw}
              strokeDasharray={`${dash} ${gap}`}
              transform={`rotate(${angle}, ${cx}, ${cx})`}
            />
          );
        })}
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        {center}
      </div>
    </div>
  );
}

export function MemPanel({ live }: { live: LiveData }) {
  const data = live.memory;
  const usedGiB = data ? (data.usedBytes / 1024 ** 3).toFixed(1) : "--";
  const totalGiB = data ? (data.totalBytes / 1024 ** 3).toFixed(1) : "--";

  const segments: DonutSegment[] = data
    ? data.segments.map((s) => ({
        pct: (s.bytes / data.totalBytes) * 100,
        color: s.color,
      }))
    : [];

  // The legend mirrors whatever segments the active platform's collector
  // produced (App/Wired/Cache/Free on macOS, Used/Cache/Free on Linux, …).
  const legend = (data?.segments ?? []).map((s) => ({
    label: s.label,
    val: formatBytes(s.bytes),
    color: s.color,
  }));

  return (
    <div className="sm-card">
      <div className="sm-header">
        <span className="sm-title">Memory</span>
        <span className="sm-headline">
          {usedGiB} / {totalGiB} GB
        </span>
      </div>
      <div className="sm-mem-body">
        <DonutRing
          size={78}
          segments={segments}
          center={
            data && (
              <>
                <span
                  style={{
                    fontSize: "1.14em",
                    fontWeight: 700,
                    lineHeight: 1,
                    color: "var(--silo-color-text-hi)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {Math.round(data.usedBytes / 1024 ** 3)}
                </span>
                <span
                  style={{
                    fontSize: "0.64em",
                    color: "var(--silo-color-text)",
                    lineHeight: 1,
                    marginTop: 2,
                  }}
                >
                  GB
                </span>
              </>
            )
          }
        />
        <div className="sm-legend">
          {legend.map(({ label, val, color }) => (
            <div key={label} className="sm-legend-row">
              <div className="sm-dot" style={{ background: color }} />
              <span className="sm-leg-label">{label}</span>
              <span className="sm-leg-val">{val}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
