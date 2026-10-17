/**
 * A per-render index over `ctx.workspaces.getState().all`.
 *
 * Two jobs, both forced by the SDK:
 *
 * 1. **Tab-adornment binders are called synchronously during render**, once per
 *    tab (`TabHighlightBinder.provide`). The 0.2.x code did a full workspace
 *    scan inside `provide` — O(workspaces × tabs) per paint. Every lookup here
 *    is a map hit against an index rebuilt once per workspace-state change.
 * 2. **The `panelId` → `DockPanelRecord.id` bridge.** A panel mark is persisted
 *    under the record's stable `id`, but the tab-adornment binder speaks
 *    `panelId` — host-composed, restamped on every load, explicitly "read it;
 *    never compose it". `Workspace.panels` is the only place the two sit side
 *    by side, so this is where they get stitched together.
 *
 *    Silo RFC 0063 put `recordId` on the two panel *contexts*, and RFC 0064
 *    puts it on the active-panel state — but neither helps the binder, which
 *    is called per tab with nothing but a `panelId`. So this stays.
 *
 * Pure — `import type` only, so the unit tests never load the SDK runtime.
 */

import type { PanelKind } from "./store";

/** The slice of `Workspace` this index reads. Structural, so tests need no SDK. */
export interface IndexedWorkspace {
  id: string;
  name: string;
  editors: readonly { id: string; filePath: string | null; title: string }[];
  terminals: readonly { id: string; title: string; customName?: string }[];
  panels?: readonly {
    id: string;
    panelId: string;
    kindId: string;
    customTitle?: string;
    /** The kind's own restore bag — read only for a title, see `panelTitle`. */
    state?: Readonly<Record<string, unknown>>;
  }[];
}

/** Where a live dock `panelId` lives, and what its mark is keyed under. */
export interface PanelLocation {
  workspaceId: string;
  /** `DockPanelRecord.id` — the persisted mark key. */
  recordId: string;
}

/** The live tab ids of one workspace, in persisted-key form. */
export interface LiveIds {
  editors: ReadonlySet<string>;
  terminals: ReadonlySet<string>;
  /** `DockPanelRecord.id`s, **not** `panelId`s. */
  panels: ReadonlySet<string>;
}

export interface WorkspaceIndex {
  /** Which workspace owns a tab, by persisted key. */
  findWorkspaceFor(kind: PanelKind, id: string): string | undefined;
  /** Resolve a live dock `panelId` to its workspace + persisted record id. */
  panelLocation(panelId: string): PanelLocation | null;
  /** Live tab ids for pruning and counting. Empty sets for an unknown workspace. */
  liveIds(workspaceId: string): LiveIds;
  /** Every workspace id currently present. */
  workspaceIds(): ReadonlySet<string>;
}

const EMPTY: LiveIds = {
  editors: new Set(),
  terminals: new Set(),
  panels: new Set(),
};

export function buildWorkspaceIndex(
  workspaces: readonly IndexedWorkspace[],
): WorkspaceIndex {
  const editorOwner = new Map<string, string>();
  const terminalOwner = new Map<string, string>();
  const panelOwner = new Map<string, string>();
  const byPanelId = new Map<string, PanelLocation>();
  const live = new Map<string, LiveIds>();
  const ids = new Set<string>();

  for (const ws of workspaces) {
    ids.add(ws.id);
    const editors = new Set<string>();
    const terminals = new Set<string>();
    const panels = new Set<string>();
    for (const e of ws.editors) {
      editors.add(e.id);
      editorOwner.set(e.id, ws.id);
    }
    for (const t of ws.terminals) {
      terminals.add(t.id);
      terminalOwner.set(t.id, ws.id);
    }
    for (const p of ws.panels ?? []) {
      panels.add(p.id);
      panelOwner.set(p.id, ws.id);
      byPanelId.set(p.panelId, { workspaceId: ws.id, recordId: p.id });
    }
    live.set(ws.id, { editors, terminals, panels });
  }

  return {
    findWorkspaceFor(kind, id) {
      if (kind === "editor") return editorOwner.get(id);
      if (kind === "terminal") return terminalOwner.get(id);
      return panelOwner.get(id);
    },
    panelLocation: (panelId) => byPanelId.get(panelId) ?? null,
    liveIds: (workspaceId) => live.get(workspaceId) ?? EMPTY,
    workspaceIds: () => ids,
  };
}

/** An index over nothing — the value to hold before the first workspace state. */
export function emptyWorkspaceIndex(): WorkspaceIndex {
  return buildWorkspaceIndex([]);
}
