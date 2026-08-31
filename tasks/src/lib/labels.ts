/**
 * Pure helpers for the core `labels` field: parsing the comma-separated edit
 * string, and a stable filled-chip style per label. A task label is just a
 * string — it carries no color of its own the way a GitHub issue label does —
 * so the chip color is derived from the text.
 */

/** Split a comma-separated edit string into trimmed, de-duplicated labels. */
export function parseLabels(input: string): string[] {
  const seen = new Set<string>();
  for (const part of input.split(",")) {
    const label = part.trim();
    if (label) seen.add(label);
  }
  return [...seen];
}

export interface LabelChipStyle {
  background: string;
  color: string;
}

/**
 * A stable filled-chip style for a label — GitHub-issue-label style: a
 * saturated background whose hue is derived from the text, with black or white
 * text picked for contrast. Deterministic, so the same label always looks the
 * same.
 */
export function labelChipStyle(label: string): LabelChipStyle {
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = (hash * 31 + label.charCodeAt(i)) | 0;
  }
  const hue = ((hash % 360) + 360) % 360;
  const sat = 65;
  const light = 45;
  return {
    background: `hsl(${hue} ${sat}% ${light}%)`,
    color: hslLuma(hue, sat, light) > 0.6 ? "#161616" : "#ffffff",
  };
}

/** Rec. 601 luma (0–1) of an HSL color — used only to pick chip text color. */
function hslLuma(h: number, s: number, l: number): number {
  const sN = s / 100;
  const lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = lN - c / 2;
  return 0.299 * (r + m) + 0.587 * (g + m) + 0.114 * (b + m);
}
