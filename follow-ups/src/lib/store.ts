/**
 * Pure marks model for Follow-ups. In-memory maps are the chrome source of
 * truth; {@link serializeMarks} / {@link parseMarks} round-trip the global
 * storage bag (`ctx.storage.global` key `"marks"`).
 *
 * A follow-up is a **record**, not a boolean: a label id (one of the five in
 * `labels.ts`), an optional note, and when it was marked. Pure — `import type`
 * only, so the unit tests never load the SDK runtime.
 */

import { migrateLabelId, type LabelId } from "./labels";

/**
 * `"panel"` is any dock panel that isn't an editor or a terminal — a Chat
 * transcript, a web viewer, whatever a kind registers. It's the one bucket
 * covering every `"panel/tab"` context-menu hit.
 *
 * Panel marks are keyed on `DockPanelRecord.id` — the record's **persisted**
 * identity — not on the `panelId` every panel-targeting API speaks.
 * `panelId` is host-composed and restamped on every load ("Read it; never
 * compose it"), so a mark keyed on it would be pruned as dead the moment the
 * app restarted. `workspace-index.ts` keeps the `panelId → record id` bridge
 * for the surfaces that only hand you a `panelId`.
 */
export type PanelKind = "editor" | "terminal" | "panel";

/** One marked tab. */
export interface FollowUp {
  /** One of the five label ids; see `labels.ts`. */
  labelId: LabelId;
  /** `""` when absent — never `undefined`, so callers never branch on both. */
  note: string;
  /** ms epoch. `0` means "migrated from the legacy boolean form, unknown". */
  markedAt: number;
}

/** The marks of one kind within one workspace, keyed by the tab's persisted id. */
export type KindMarks = Map<string, FollowUp>;

export interface WorkspaceMarks {
  editors: KindMarks;
  terminals: KindMarks;
  panels: KindMarks;
}

export type MarksState = Map<string, WorkspaceMarks>;

/** Persisted per-tab shape. `label` rather than `labelId` — it's the whole record. */
export interface StoredFollowUp {
  label: string;
  note?: string;
  markedAt?: number;
}

/**
 * Persisted shape under `ctx.storage.global` key `"marks"`.
 *
 * There is no version field: the legacy (0.2.x) per-kind value was a
 * `string[]` and the current one is a `Record`, so the two are distinguishable
 * by JS type alone — see {@link parseMarks}.
 */
export type MarksBag = Record<
  string,
  {
    editors: Record<string, StoredFollowUp>;
    terminals: Record<string, StoredFollowUp>;
    panels: Record<string, StoredFollowUp>;
  }
>;

/**
 * Whether (and how) a mutation changed the state. Replaces the old `boolean`:
 * a boolean "already present ⇒ no change" would silently swallow a re-label or
 * a note edit, which is most of what 0.3.0 added.
 */
export type MarkChange = "none" | "added" | "updated" | "removed";

export function emptyWorkspaceMarks(): WorkspaceMarks {
  return { editors: new Map(), terminals: new Map(), panels: new Map() };
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

function mapFor(marks: WorkspaceMarks, kind: PanelKind): KindMarks {
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

export function getFollowUp(
  state: MarksState,
  workspaceId: string,
  kind: PanelKind,
  id: string,
): FollowUp | null {
  const marks = state.get(workspaceId);
  if (!marks) return null;
  return mapFor(marks, kind).get(id) ?? null;
}

export function isMarked(
  state: MarksState,
  workspaceId: string,
  kind: PanelKind,
  id: string,
): boolean {
  return getFollowUp(state, workspaceId, kind, id) !== null;
}

/**
 * Mark a tab, or re-label / re-note one already marked.
 *
 * Returns `"added"` when the tab wasn't marked, `"updated"` when the label or
 * the note changed, and `"none"` only when **both** are unchanged. An update
 * preserves the original `markedAt` — re-labelling is not re-marking, and the
 * Navigator's "most recent first" order shouldn't jump because a user picked a
 * different name for the same wait.
 *
 * `note` omitted on an update keeps the existing note; pass `""` to clear it.
 */
export function setFollowUp(
  state: MarksState,
  workspaceId: string,
  kind: PanelKind,
  id: string,
  next: { labelId: LabelId; note?: string },
  now: number,
): MarkChange {
  const map = mapFor(ensureWorkspace(state, workspaceId), kind);
  const existing = map.get(id);
  if (!existing) {
    map.set(id, {
      labelId: next.labelId,
      note: next.note ?? "",
      markedAt: now,
    });
    return "added";
  }
  const note = next.note ?? existing.note;
  if (existing.labelId === next.labelId && existing.note === note) return "none";
  map.set(id, { labelId: next.labelId, note, markedAt: existing.markedAt });
  return "updated";
}

export function clearFollowUp(
  state: MarksState,
  workspaceId: string,
  kind: PanelKind,
  id: string,
): MarkChange {
  const marks = state.get(workspaceId);
  if (!marks) return "none";
  const map = mapFor(marks, kind);
  if (!map.delete(id)) return "none";
  if (isEmpty(marks)) state.delete(workspaceId);
  return "removed";
}

/** Set or clear the note on an already-marked tab. `"none"` when unmarked. */
export function setNote(
  state: MarksState,
  workspaceId: string,
  kind: PanelKind,
  id: string,
  note: string,
): MarkChange {
  const existing = getFollowUp(state, workspaceId, kind, id);
  if (!existing) return "none";
  if (existing.note === note) return "none";
  mapFor(ensureWorkspace(state, workspaceId), kind).set(id, {
    ...existing,
    note,
  });
  return "updated";
}

/** Mark with the default label when unmarked; clear when marked. */
export function toggleFollowUp(
  state: MarksState,
  workspaceId: string,
  kind: PanelKind,
  id: string,
  defaultLabelId: LabelId,
  now: number,
): MarkChange {
  if (isMarked(state, workspaceId, kind, id)) {
    return clearFollowUp(state, workspaceId, kind, id);
  }
  return setFollowUp(
    state,
    workspaceId,
    kind,
    id,
    { labelId: defaultLabelId },
    now,
  );
}

/**
 * Drop marks whose tab ids are no longer present. Returns true when anything
 * was removed.
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
  const kinds: [KindMarks, ReadonlySet<string>][] = [
    [marks.editors, liveEditors],
    [marks.terminals, liveTerminals],
    [marks.panels, livePanels],
  ];
  for (const [map, live] of kinds) {
    for (const id of [...map.keys()]) {
      if (!live.has(id)) {
        map.delete(id);
        changed = true;
      }
    }
  }
  if (isEmpty(marks)) state.delete(workspaceId);
  return changed;
}

/** A workspace's follow-up rollup — what the Workspaces panel row shows. */
export interface MarksSummary {
  /** How many live tabs in this workspace carry a follow-up. */
  count: number;
  /** Live marks per label id. Labels with none are absent, never `0`. */
  byLabel: Partial<Record<LabelId, number>>;
}

/**
 * Roll a workspace's live marks up into **one** line's worth of data.
 *
 * Still one line, but `byLabel` carries the breakdown the Workspaces panel
 * paints as a cluster of colored dots in front of the count. A *row* per label
 * would bury the workspace's own chrome under four lines of this extension's;
 * a dot per label spends no extra vertical space at all. The itemized
 * breakdown — which tab, which note — stays in the Navigator view.
 */
export function summarizeMarks(
  state: MarksState,
  workspaceId: string,
  liveEditors?: ReadonlySet<string>,
  liveTerminals?: ReadonlySet<string>,
  livePanels?: ReadonlySet<string>,
): MarksSummary {
  const summary: MarksSummary = { count: 0, byLabel: {} };
  const marks = state.get(workspaceId);
  if (!marks) return summary;
  const kinds: [KindMarks, ReadonlySet<string> | undefined][] = [
    [marks.editors, liveEditors],
    [marks.terminals, liveTerminals],
    [marks.panels, livePanels],
  ];
  for (const [map, live] of kinds) {
    for (const [id, fu] of map) {
      if (live && !live.has(id)) continue;
      summary.count++;
      summary.byLabel[fu.labelId] = (summary.byLabel[fu.labelId] ?? 0) + 1;
    }
  }
  return summary;
}

export function statusLabel(count: number): string {
  return count === 1 ? "1 follow-up" : `${count} follow-ups`;
}

function serializeKind(map: KindMarks): Record<string, StoredFollowUp> {
  const out: Record<string, StoredFollowUp> = {};
  // Canonical key order so the persisted JSON stays diffable — the records
  // replaced the old `.sort()`ed arrays, and object key order is insertion
  // order, so this is where that guarantee now lives.
  for (const id of [...map.keys()].sort()) {
    const fu = map.get(id)!;
    const stored: StoredFollowUp = { label: fu.labelId };
    if (fu.note !== "") stored.note = fu.note;
    if (fu.markedAt !== 0) stored.markedAt = fu.markedAt;
    out[id] = stored;
  }
  return out;
}

export function serializeMarks(state: MarksState): MarksBag {
  const bag: MarksBag = {};
  for (const workspaceId of [...state.keys()].sort()) {
    const marks = state.get(workspaceId)!;
    if (isEmpty(marks)) continue;
    bag[workspaceId] = {
      editors: serializeKind(marks.editors),
      terminals: serializeKind(marks.terminals),
      panels: serializeKind(marks.panels),
    };
  }
  return bag;
}

/**
 * Parse the persisted bag, migrating the legacy 0.2.x form in the same pass.
 *
 * The branch is **per kind, not per workspace**: legacy is a `string[]` and
 * the current form is a `Record`, and nothing rewrites storage until the first
 * mutation, so a half-migrated bag (legacy `editors`, new `terminals`, same
 * workspace) is a real state this has to parse correctly.
 *
 * A migrated mark carries the default label, no note, and `markedAt: 0` —
 * the boolean form recorded no "why" and no "when", and inventing a timestamp
 * would put every old mark at the top of the Navigator's recent-first order.
 *
 * Stays pure: no clock and no SDK import, so the default label id is an
 * argument.
 */
export function parseMarks(raw: unknown, defaultLabelId: LabelId): MarksState {
  const state: MarksState = new Map();
  if (!raw || typeof raw !== "object") return state;
  for (const [workspaceId, entry] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const marks: WorkspaceMarks = {
      editors: parseKind(e.editors, defaultLabelId),
      terminals: parseKind(e.terminals, defaultLabelId),
      panels: parseKind(e.panels, defaultLabelId),
    };
    if (isEmpty(marks)) continue;
    state.set(workspaceId, marks);
  }
  return state;
}

function parseKind(raw: unknown, defaultLabelId: LabelId): KindMarks {
  const map: KindMarks = new Map();
  if (Array.isArray(raw)) {
    // Legacy 0.2.x: a bare list of marked ids.
    for (const id of raw) {
      if (typeof id === "string" && id.length > 0) {
        map.set(id, { labelId: defaultLabelId, note: "", markedAt: 0 });
      }
    }
    return map;
  }
  if (!raw || typeof raw !== "object") return map;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const v = value as StoredFollowUp;
    map.set(id, {
      // Any label id this build doesn't know resolves to the default rather
      // than throwing — there is one label per color, so an unrecognized value
      // can only be garbage or a future build's.
      labelId: isKnownLabel(v.label, defaultLabelId),
      note: typeof v.note === "string" ? v.note : "",
      markedAt: typeof v.markedAt === "number" && Number.isFinite(v.markedAt)
        ? v.markedAt
        : 0,
    });
  }
  return map;
}

/**
 * A stored label id as this build knows it. `migrateLabelId` carries a
 * retired id across (`"accent"` → `"info"`), so a tab flagged before the
 * fifth color changed keeps its label rather than silently reverting to the
 * default.
 */
function isKnownLabel(raw: unknown, fallback: LabelId): LabelId {
  return migrateLabelId(raw) ?? fallback;
}
