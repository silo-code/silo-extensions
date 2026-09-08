/**
 * Plain-text preview truncation — used by a provider's `toTask()` mapping to
 * build `Task.descriptionPreview` (R15) from a full, possibly multi-line
 * description. No React, no `ctx`.
 */

const DEFAULT_MAX = 140;

/**
 * Collapses whitespace/newlines to single spaces, then truncates to at most
 * `max` characters — breaking on the last word boundary within range rather
 * than mid-word, when one exists. Returns `undefined` for empty/whitespace-only
 * input, so callers can write `descriptionPreview: truncatePreview(text)`
 * without a separate empty-string check.
 */
export function truncatePreview(
  text: string | undefined,
  max: number = DEFAULT_MAX,
): string | undefined {
  const collapsed = (text ?? "").replace(/\s+/g, " ").trim();
  if (collapsed === "") return undefined;
  if (collapsed.length <= max) return collapsed;
  const cut = collapsed.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  // Only break on a word boundary if it doesn't throw away most of the
  // budget — a single very long word just gets a hard cut.
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${base.trimEnd()}…`;
}
