/**
 * Tiny SVG sparkline for weekly install series from skills.sh.
 * Pure presentational — no host tokens beyond currentColor inheritance.
 */

import { buildSparklinePoints } from "./sparkline";

export function InstallSparkline({
  values,
  title,
}: {
  values: readonly number[];
  title?: string;
}) {
  if (values.length < 2) return null;
  const w = 56;
  const h = 16;
  const pts = buildSparklinePoints(values, w, h);
  return (
    <svg
      className="skills-sparkline"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={pts}
      />
    </svg>
  );
}
