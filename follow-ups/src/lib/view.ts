/**
 * The Navigator view's projection: marks + workspaces → flat items → groups.
 *
 * One filter-then-group entry point ({@link buildFollowUpView}), so the view
 * body never re-derives grouping of its own. Pure — `import type` only, so the
 * unit tests never load the SDK runtime.
 */

import { labelById, type FollowUpLabel } from "./labels";
import type { MarksState, PanelKind } from "./store";
import type { IndexedWorkspace } from "./workspace-index";

export type FollowUpGroupBy = "none" | "workspace" | "label";

export const GROUP_BY_VALUES: readonly FollowUpGroupBy[] = [
  "none",
  "workspace",
  "label",
];

export const GROUP_BY_LABELS: Readonly<Record<FollowUpGroupBy, string>> = {
  none: "None",
  workspace: "Workspace",
  label: "Label",
};

/** One flagged tab, everything the Navigator row and its reveal need. */
export interface FollowUpItem {
  workspaceId: string;
  workspaceName: string;
  kind: PanelKind;
  /** The persisted key (editor id | terminal id | `DockPanelRecord.id`). */
  id: string;
  /** The live id a reveal acts on — `panelId` for a dock panel. */
  targetId: string;
  filePath: string | null;
  title: string;
  labelId: string;
  note: string;
  markedAt: number;
}

export interface FollowUpGroup {
  key: string;
  /** `""` for the single unlabeled group — a header-less flat list. */
  title: string;
  collapsed: boolean;
  items: FollowUpItem[];
}

/** A row key unique across workspaces and kinds — for React and collapse state. */
export function itemKey(item: FollowUpItem): string {
  return `${item.workspaceId}/${item.kind}/${item.id}`;
}

/**
 * Every live marked tab across every workspace, newest first.
 *
 * Marks whose tab is gone are skipped rather than reported: the workspace
 * lists are the source of truth for what exists, and `index.tsx` prunes the
 * same ids out of storage on the next workspace change anyway.
 */
export function collectItems(
  workspaces: readonly IndexedWorkspace[],
  state: MarksState,
): FollowUpItem[] {
  const items: FollowUpItem[] = [];
  for (const ws of workspaces) {
    const marks = state.get(ws.id);
    if (!marks) continue;
    for (const e of ws.editors) {
      const fu = marks.editors.get(e.id);
      if (!fu) continue;
      items.push({
        workspaceId: ws.id,
        workspaceName: ws.name,
        kind: "editor",
        id: e.id,
        targetId: e.id,
        filePath: e.filePath,
        title: e.title,
        labelId: fu.labelId,
        note: fu.note,
        markedAt: fu.markedAt,
      });
    }
    for (const t of ws.terminals) {
      const fu = marks.terminals.get(t.id);
      if (!fu) continue;
      items.push({
        workspaceId: ws.id,
        workspaceName: ws.name,
        kind: "terminal",
        id: t.id,
        targetId: t.id,
        filePath: null,
        // A user-assigned name wins over the PTY-derived title, same as the tab.
        title: t.customName || t.title,
        labelId: fu.labelId,
        note: fu.note,
        markedAt: fu.markedAt,
      });
    }
    for (const p of ws.panels ?? []) {
      const fu = marks.panels.get(p.id);
      if (!fu) continue;
      items.push({
        workspaceId: ws.id,
        workspaceName: ws.name,
        kind: "panel",
        id: p.id,
        targetId: p.panelId,
        filePath: null,
        title: panelTitle(p),
        labelId: fu.labelId,
        note: fu.note,
        markedAt: fu.markedAt,
      });
    }
  }
  return sortItems(items);
}

/**
 * The best name available for a dock panel's tab, in order:
 *
 * 1. `customTitle` — the name the **user** gave the tab. Host-owned, so it
 *    wins over anything the panel says about itself, exactly as it does on the
 *    tab.
 * 2. `state.title` — a convention, not a contract. `DockPanelRecord.state` is
 *    the kind's own bag and the host never inspects it, so this is a guess —
 *    but a panel that calls `DockPanelApi.setTitle` has to persist that title
 *    somewhere to restore it, and `state.title` is where they put it (the
 *    bundled Agent Chat panel included). Guarded on a non-empty string, so a
 *    kind that uses the key for something else just falls through.
 * 3. `kindId`, prettified — a developer identifier, but the only thing left.
 *
 * There is no SDK read path for the live title a panel pushed via
 * `setTitle`: it goes straight to the dock view model and is never written
 * back onto the record. Until the host exposes one, step 2 is the closest
 * thing.
 */
export function panelTitle(p: {
  kindId: string;
  customTitle?: string;
  state?: Readonly<Record<string, unknown>>;
}): string {
  if (p.customTitle) return p.customTitle;
  const stateTitle = p.state?.title;
  if (typeof stateTitle === "string" && stateTitle.trim() !== "") {
    return stateTitle.trim();
  }
  return prettifyKindId(p.kindId);
}

/** `silo.agents-chat-panel` → `Agents Chat Panel`. */
function prettifyKindId(kindId: string): string {
  const bare = kindId.slice(kindId.lastIndexOf(".") + 1);
  const words = bare
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1));
  return words.length > 0 ? words.join(" ") : kindId;
}

/**
 * Most recently marked first, with `markedAt: 0` (migrated from the 0.2.x
 * boolean form, so genuinely unknown) last rather than oldest — an unknown
 * time isn't evidence of age. Ties break on title so the order is stable.
 */
export function sortItems(items: readonly FollowUpItem[]): FollowUpItem[] {
  return [...items].sort((a, b) => {
    if (a.markedAt !== b.markedAt) {
      if (a.markedAt === 0) return 1;
      if (b.markedAt === 0) return -1;
      return b.markedAt - a.markedAt;
    }
    return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  });
}

/** How many items carry each label id — for the group count badges. */
export function countByLabel(
  items: readonly FollowUpItem[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of items) {
    out.set(item.labelId, (out.get(item.labelId) ?? 0) + 1);
  }
  return out;
}

/**
 * The one entry point: sort, then group. Every group's rows are already in
 * recent-first order.
 *
 * A chosen grouping **always** draws its headers, even when only one group has
 * anything in it — one workspace's follow-ups still want that workspace named,
 * the way the host's Agents view names it. `"none"` is how a user asks for a
 * flat list, so auto-flattening a grouping would erase the only difference
 * between the two modes.
 */
export function buildFollowUpView(
  items: readonly FollowUpItem[],
  labels: readonly FollowUpLabel[],
  groupBy: FollowUpGroupBy,
  collapsed: Readonly<Record<string, boolean>>,
): FollowUpGroup[] {
  const sorted = sortItems(items);
  if (groupBy === "none") return [flat(sorted)];
  const groups =
    groupBy === "workspace"
      ? groupByWorkspace(sorted)
      : groupByLabel(sorted, labels);
  // Nothing at all still yields one empty group, so the view has a shape to
  // render rather than `undefined`.
  if (groups.length === 0) return [flat(sorted)];
  return groups.map((g) => ({ ...g, collapsed: collapsed[g.key] === true }));
}

function flat(items: readonly FollowUpItem[]): FollowUpGroup {
  return { key: "all", title: "", collapsed: false, items: [...items] };
}

function groupByWorkspace(items: readonly FollowUpItem[]): FollowUpGroup[] {
  const byWs = new Map<string, FollowUpItem[]>();
  const names = new Map<string, string>();
  // Insertion order is the workspaces' own order, since `collectItems` walks
  // them in order — but a `sortItems` pass sits in between, so re-derive it
  // from the first appearance of each workspace instead of assuming.
  for (const item of items) {
    names.set(item.workspaceId, item.workspaceName);
    const bucket = byWs.get(item.workspaceId) ?? [];
    bucket.push(item);
    byWs.set(item.workspaceId, bucket);
  }
  return [...byWs.entries()].map(([id, bucket]) => ({
    key: id,
    title: names.get(id) ?? id,
    collapsed: false,
    items: bucket,
  }));
}

/** Groups follow the **user's** settings order, not alphabetical. */
function groupByLabel(
  items: readonly FollowUpItem[],
  labels: readonly FollowUpLabel[],
): FollowUpGroup[] {
  const byLabel = new Map<string, FollowUpItem[]>();
  for (const item of items) {
    // An id this build doesn't know buckets under the default rather than
    // vanishing from the grouping — the same resolution `labelById` does for
    // the tint and the dropdown.
    const key = labelById(labels, item.labelId).id;
    const bucket = byLabel.get(key) ?? [];
    bucket.push(item);
    byLabel.set(key, bucket);
  }
  return labels
    .filter((l) => (byLabel.get(l.id)?.length ?? 0) > 0)
    .map((l) => ({
      key: l.id,
      title: l.name,
      collapsed: false,
      items: byLabel.get(l.id) ?? [],
    }));
}
