/**
 * Pure marks model for Follow-ups. In-memory maps are the chrome source of
 * truth; {@link serializeMarks} / {@link parseMarks} round-trip the global
 * storage bag (`ctx.storage.global` key `"marks"`).
 */

/** `"panel"` is any dock panel that isn't an editor or a terminal — a Chat
 *  transcript, a web viewer, whatever a kind registers. It's the one bucket
 *  covering every `"panel/tab"` context-menu hit, keyed by the tab's own
 *  `panelId` (`kindId:recordId`) rather than a per-kind id shape, since a
 *  dock panel's identity is already that one string. */
export type PanelKind = "editor" | "terminal" | "panel";

export interface WorkspaceMarks {
  editors: Set<string>;
  terminals: Set<string>;
  panels: Set<string>;
}

/** Persisted shape under `ctx.storage.global` key `"marks"`. */
export type MarksBag = Record<
  string,
  { editors: string[]; terminals: string[]; panels: string[] }
>;

export type MarksState = Map<string, WorkspaceMarks>;

export function emptyWorkspaceMarks(): WorkspaceMarks {
  return { editors: new Set(), terminals: new Set(), panels: new Set() };
}

export function ensureWorkspace(
  state: MarksState,
  workspaceId: string,
): WorkspaceMarks {
  let marks = state.get(workspaceId);
  if (!marks) {
    marks = emptyWorkspaceMarks();
    state.set(workspaceId, marks);
  }
  return marks;
}

function setFor(
  marks: WorkspaceMarks,
  kind: PanelKind,
): Set<string> {
  if (kind === "editor") return marks.editors;
  if (kind === "terminal") return marks.terminals;
  return marks.panels;
}

function isEmpty(marks: WorkspaceMarks): boolean {
  return (
    marks.editors.size === 0 &&
    marks.terminals.size === 0 &&
    marks.panels.size === 0
  );
}

export function isMarked(
  state: MarksState,
  workspaceId: string,
  kind: PanelKind,
  id: string,
): boolean {
  const marks = state.get(workspaceId);
  if (!marks) return false;
  return setFor(marks, kind).has(id);
}

/** Returns true when the mark state changed. */
export function mark(
  state: MarksState,
  workspaceId: string,
  kind: PanelKind,
  id: string,
): boolean {
  const set = setFor(ensureWorkspace(state, workspaceId), kind);
  if (set.has(id)) return false;
  set.add(id);
  return true;
}

/** Returns true when the mark state changed. */
export function clear(
  state: MarksState,
  workspaceId: string,
  kind: PanelKind,
  id: string,
): boolean {
  const marks = state.get(workspaceId);
  if (!marks) return false;
  const set = setFor(marks, kind);
  if (!set.has(id)) return false;
  set.delete(id);
  if (isEmpty(marks)) state.delete(workspaceId);
  return true;
}

/** Returns true when the mark state changed. */
export function toggle(
  state: MarksState,
  workspaceId: string,
  kind: PanelKind,
  id: string,
): boolean {
  if (isMarked(state, workspaceId, kind, id)) {
    return clear(state, workspaceId, kind, id);
  }
  return mark(state, workspaceId, kind, id);
}

/**
 * Drop marks whose panel ids are no longer present. Returns true when
 * anything was removed.
 */
export function pruneWorkspace(
  state: MarksState,
  workspaceId: string,
  liveEditors: ReadonlySet<string>,
  liveTerminals: ReadonlySet<string>,
  livePanels: ReadonlySet<string>,
): boolean {
  const marks = state.get(workspaceId);
  if (!marks) return false;
  let changed = false;
  for (const id of [...marks.editors]) {
    if (!liveEditors.has(id)) {
      marks.editors.delete(id);
      changed = true;
    }
  }
  for (const id of [...marks.terminals]) {
    if (!liveTerminals.has(id)) {
      marks.terminals.delete(id);
      changed = true;
    }
  }
  for (const id of [...marks.panels]) {
    if (!livePanels.has(id)) {
      marks.panels.delete(id);
      changed = true;
    }
  }
  if (isEmpty(marks)) state.delete(workspaceId);
  return changed;
}

/** Count of live marked panels in a workspace (editors + terminals + other
 *  dock panels). */
export function countMarks(
  state: MarksState,
  workspaceId: string,
  liveEditors?: ReadonlySet<string>,
  liveTerminals?: ReadonlySet<string>,
  livePanels?: ReadonlySet<string>,
): number {
  const marks = state.get(workspaceId);
  if (!marks) return 0;
  let n = 0;
  for (const id of marks.editors) {
    if (!liveEditors || liveEditors.has(id)) n++;
  }
  for (const id of marks.terminals) {
    if (!liveTerminals || liveTerminals.has(id)) n++;
  }
  for (const id of marks.panels) {
    if (!livePanels || livePanels.has(id)) n++;
  }
  return n;
}

export function statusLabel(count: number): string {
  return count === 1 ? "1 follow-up" : `${count} follow-ups`;
}

export function serializeMarks(state: MarksState): MarksBag {
  const bag: MarksBag = {};
  for (const [workspaceId, marks] of state) {
    if (isEmpty(marks)) continue;
    bag[workspaceId] = {
      editors: [...marks.editors].sort(),
      terminals: [...marks.terminals].sort(),
      panels: [...marks.panels].sort(),
    };
  }
  return bag;
}

export function parseMarks(raw: unknown): MarksState {
  const state: MarksState = new Map();
  if (!raw || typeof raw !== "object") return state;
  for (const [workspaceId, entry] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as { editors?: unknown; terminals?: unknown; panels?: unknown };
    const editors = Array.isArray(e.editors)
      ? e.editors.filter((x): x is string => typeof x === "string")
      : [];
    const terminals = Array.isArray(e.terminals)
      ? e.terminals.filter((x): x is string => typeof x === "string")
      : [];
    const panels = Array.isArray(e.panels)
      ? e.panels.filter((x): x is string => typeof x === "string")
      : [];
    if (editors.length === 0 && terminals.length === 0 && panels.length === 0) {
      continue;
    }
    state.set(workspaceId, {
      editors: new Set(editors),
      terminals: new Set(terminals),
      panels: new Set(panels),
    });
  }
  return state;
}
