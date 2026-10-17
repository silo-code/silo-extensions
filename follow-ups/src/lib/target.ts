/**
 * Which tab a follow-up action applies to, resolved from whichever surface
 * invoked it. Pure — `import type` only.
 */

import type { MenuContext, ToolbarItemContext } from "@silo-code/sdk";
import type { PanelKind } from "./store";
import type { PanelLocation } from "./workspace-index";

/** The tab a follow-up action applies to. */
export interface PanelTarget {
  kind: PanelKind;
  /**
   * The **persisted** key: an editor id, a terminal id, or a
   * `DockPanelRecord.id` (never a `panelId` — see `workspace-index.ts`).
   */
  id: string;
  workspaceId: string;
}

/** The active center-dock tab, as the three ids the SDK reports separately. */
export interface ActiveTab {
  /** `ctx.editors.getState().active?.editorId` */
  editorId: string | null;
  /** `ctx.terminals.getState()` */
  terminalId: string | null;
  /**
   * The active dock panel (`ctx.panels.getState()`). Needs both ids:
   * `recordId` is what a mark is filed under, `workspaceId` is which
   * workspace's dock it is active in — and unlike an editor or a terminal,
   * there is no index entry to recover the latter from on a transient kind.
   * `null` when an editor or terminal is active.
   */
  panel: { recordId: string; workspaceId: string } | null;
}

/**
 * The RFC 0046 `"panel/tab"` context-menu target. Field-for-field identical to
 * a `"panel"` toolbar item's target, which is why one resolver covers both.
 */
export type PanelTabMenuContext = MenuContext["panel/tab"];

/** The lookups {@link resolveTarget} needs from the live workspace index. */
export interface TargetLookups {
  /** Which workspace owns a tab, by persisted key. */
  workspaceFor(kind: PanelKind, id: string): string | undefined;
  /** A live dock `panelId` resolved to its workspace + persisted record id. */
  panelFor(panelId: string): PanelLocation | null;
}

/**
 * Resolve a {@link PanelTarget} from the RFC 0039 "panel" toolbar context or
 * the RFC 0046 `"panel/tab"` menu context — both carry the identical
 * `{ panelId, kindId, workspaceId, params }` shape, so one resolver covers
 * both.
 *
 * The terminal's own id lives at `params.terminalId` (its toolbar item is
 * folded onto the shared "panel" strip); every other kind's **persisted**
 * identity is its `DockPanelRecord.id`, which only `Workspace.panels` can
 * supply — hence `panelFor`. A panel whose kind never opted into persistence
 * (`persistence: "recorded"`) has no record and so no stable key: that
 * resolves to `null` rather than silently persisting a mark under a `panelId`
 * the host restamps on the next load.
 *
 * **`t.workspaceId` is not trusted on its own.** The host resolves a panel
 * chrome's workspace from the panel's own record when it has one and from the
 * dock's registration otherwise, and the fallback half reports `""` for a
 * terminal tab that was already open when the app started — observed live:
 * `{ kindId: "terminal", workspaceId: "", params: { terminalId } }`, while a
 * terminal created later in the same session carries the real id. An empty
 * workspace silently files the mark under a workspace that does not exist, so
 * the Flag reads unmarked and clicking it appears to do nothing (the phantom
 * mark is pruned on the next workspace tick). The index is the authority
 * whenever the surface's id is blank — the same `||` guard the
 * `"terminal/tab"` menu path has always had.
 *
 * `panel/tab` never fires for a terminal — it has its own `"terminal/tab"`
 * surface — so the terminal branch only ever matters for a toolbar invocation.
 */
export function targetFromPanelContext(
  t: ToolbarItemContext["panel"] | PanelTabMenuContext,
  lookups: TargetLookups,
): PanelTarget | null {
  if (t.kindId === "terminal") {
    const terminalId = (t.params as { terminalId?: string }).terminalId;
    if (typeof terminalId !== "string") return null;
    const workspaceId =
      t.workspaceId || lookups.workspaceFor("terminal", terminalId);
    if (!workspaceId) return null;
    return { kind: "terminal", id: terminalId, workspaceId };
  }
  // Both panel contexts carry `recordId`, so the common path needs no lookup
  // at all — but it's optional even so: a transient panel kind (one that never
  // opted into `persistence: "recorded"`) has no record and so no id. The index
  // is the fallback, and stays necessary regardless for the adornment binder,
  // which is handed only a `panelId`; it also covers a context whose
  // `workspaceId` came back blank.
  const recordId = typeof t.recordId === "string" ? t.recordId : undefined;
  if (recordId && t.workspaceId) {
    return { kind: "panel", id: recordId, workspaceId: t.workspaceId };
  }
  const located = lookups.panelFor(t.panelId);
  if (!located) return null;
  return {
    kind: "panel",
    id: located.recordId,
    // The record's own `workspaceId` wins over the surface's: they agree, and
    // the record is the thing the mark is filed under.
    workspaceId: located.workspaceId,
  };
}

type SurfaceContext =
  | ToolbarItemContext["editor"]
  | ToolbarItemContext["panel"]
  | PanelTabMenuContext
  | MenuContext["editor/tab"]
  | MenuContext["terminal/tab"]
  | undefined;

/**
 * Which tab an invocation of the follow-up commands acts on.
 *
 * A toolbar button or tab context menu passes the tab it belongs to as the
 * first argument. **A keybinding passes nothing** — `executeCommand(id)` is
 * called with no args — so a command that read only `args[0]` would silently
 * do nothing when bound to a key. Falling back to the active tab is what makes
 * these commands bindable at all (and what a user assigning a shortcut to
 * "Follow-ups: Toggle" expects: it acts on the tab they're looking at).
 */
export function resolveTarget(
  args: unknown[],
  active: ActiveTab,
  lookups: TargetLookups,
): PanelTarget | null {
  return fromArgs(args, lookups) ?? fromActiveTab(active, lookups);
}

function fromArgs(
  args: unknown[],
  lookups: TargetLookups,
): PanelTarget | null {
  const t = args[0] as SurfaceContext;
  if (!t || typeof t !== "object") return null;
  if ("editorId" in t && typeof t.editorId === "string") {
    return withWorkspace("editor", t.editorId, lookups);
  }
  if (
    "panelId" in t &&
    typeof t.panelId === "string" &&
    "kindId" in t &&
    typeof t.kindId === "string" &&
    "workspaceId" in t &&
    typeof t.workspaceId === "string"
  ) {
    // Same shape whether this came from the "panel/tab" tab-context menu or
    // the RFC 0039 "panel" toolbar strip.
    return targetFromPanelContext(t as ToolbarItemContext["panel"], lookups);
  }
  if ("terminalId" in t && typeof t.terminalId === "string") {
    // The terminal surfaces carry their own workspace id; a terminal can be
    // acted on from a workspace that isn't the active one.
    const workspaceId =
      "workspaceId" in t && typeof t.workspaceId === "string"
        ? t.workspaceId
        : lookups.workspaceFor("terminal", t.terminalId);
    if (!workspaceId) return null;
    return { kind: "terminal", id: t.terminalId, workspaceId };
  }
  return null;
}

function fromActiveTab(
  active: ActiveTab,
  lookups: TargetLookups,
): PanelTarget | null {
  // At most one is set: all three report the same single active center-dock
  // tab, and the host guarantees the panel state is `null` whenever an editor
  // or a terminal holds it.
  if (active.terminalId) {
    return withWorkspace("terminal", active.terminalId, lookups);
  }
  if (active.editorId) {
    return withWorkspace("editor", active.editorId, lookups);
  }
  if (active.panel) {
    // The workspace comes with it, so no index lookup — which also means a
    // keybinding works on a panel whose workspace the index hasn't seen yet.
    return {
      kind: "panel",
      id: active.panel.recordId,
      workspaceId: active.panel.workspaceId,
    };
  }
  return null;
}

function withWorkspace(
  kind: PanelKind,
  id: string,
  lookups: TargetLookups,
): PanelTarget | null {
  const workspaceId = lookups.workspaceFor(kind, id);
  return workspaceId ? { kind, id, workspaceId } : null;
}
