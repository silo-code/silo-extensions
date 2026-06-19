import type { FileMeta, FocusGroupItemProps } from "@silo-code/sdk";

export type Listing = { entries: FileMeta[]; error?: string };

export const ROW_INDENT_PX = 14;
export const ROW_BASE_PX = 6;

export function rowIndent(depth: number): React.CSSProperties {
  return { paddingLeft: `${ROW_BASE_PX + depth * ROW_INDENT_PX}px` };
}

export function rootName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

/** Props spread onto a focusable tree row. Empty record for non-focus rows (root header). */
export type RowFocusProps = FocusGroupItemProps | Record<string, never>;
