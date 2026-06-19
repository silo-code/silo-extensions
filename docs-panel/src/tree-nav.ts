import type { Listing } from "./tree-types";

export interface FlatNode {
  path: string;
  isDir: boolean;
}

/**
 * The currently-visible rows in document order. Mirrors the DOM order so
 * useFocusGroup's arrow movement lands on the visually-adjacent row.
 */
export function flattenVisible(
  root: string,
  listings: Record<string, Listing>,
  expanded: Record<string, boolean>,
): FlatNode[] {
  const result: FlatNode[] = [];
  function walk(dirPath: string): void {
    if (!expanded[dirPath]) return;
    const listing = listings[dirPath];
    if (!listing || listing.error) return;
    for (const e of listing.entries) {
      result.push({ path: e.path, isDir: e.isDir });
      if (e.isDir) walk(e.path);
    }
  }
  walk(root);
  return result;
}

export type TreeArrowAction =
  | { kind: "expand"; path: string }
  | { kind: "collapse"; path: string }
  | { kind: "focusParent"; path: string };

/** Pure keyboard-navigation logic for ← / → on tree rows. */
export function treeArrowNav(opts: {
  key: "ArrowLeft" | "ArrowRight";
  path: string;
  isDir: boolean;
  expanded: Record<string, boolean>;
  root: string;
}): TreeArrowAction | null {
  const { key, path, isDir, expanded, root } = opts;
  if (key === "ArrowRight") {
    return isDir && !expanded[path] ? { kind: "expand", path } : null;
  }
  // ArrowLeft
  if (isDir && expanded[path]) return { kind: "collapse", path };
  const idx = path.lastIndexOf("/");
  const parent = idx <= 0 ? "/" : path.slice(0, idx);
  if (parent && parent !== root) return { kind: "focusParent", path: parent };
  return null;
}
