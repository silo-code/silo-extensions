/** Pure point-math for a tiny SVG sparkline. Kept free of React so it's unit-testable. */
export function buildSparklinePoints(
  values: readonly number[],
  w: number,
  h: number,
): string {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(max - min, 1);
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
