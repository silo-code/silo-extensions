import type { MenuContext, ToolbarItemContext } from "@silo-code/sdk";
import type { PanelKind } from "./store";

/** The tab a follow-up action applies to. */
export interface PanelTarget {
  kind: PanelKind;
  id: string;
  workspaceId: string;
}

/** The active center-dock tab, as the two ids the SDK reports separately. */
export interface ActiveTab {
  /** `ctx.editors.getState().active?.editorId` */
  editorId: string | null;
  /** `ctx.terminals.getActive()` */
  terminalId: string | null;
}

/**
 * The RFC 0046 `"panel/tab"` context-menu target — every dock panel tab that
 * isn't an editor or a terminal (those keep `editor/tab` / `terminal/tab`).
 * The published SDK (^0.48.0) predates it, so this shape is declared here
 * rather than read off `MenuContext["panel/tab"]`.
 */
export interface PanelTabMenuContext {
  panelId: string;
  kindId: string;
  workspaceId: string;
  params: Readonly<Record<string, unknown>>;
}

/**
 * Resolve a {@link PanelTarget} from the RFC 0039 "panel" toolbar context or
 * the RFC 0046 `"panel/tab"` menu context — both carry the identical
 * `{ panelId, kindId, workspaceId, params }` shape, so one resolver covers
 * both. The terminal's own id lives at `params.terminalId` (its toolbar item
 * is folded onto the shared "panel" strip); every other kind's identity is
 * `panelId` itself. `panel/tab` never fires for a terminal — it has its own
 * `"terminal/tab"` surface — so the terminal branch only ever matters for a
 * toolbar invocation.
 */
export function targetFromPanelContext(
  t: ToolbarItemContext["panel"] | PanelTabMenuContext,
): PanelTarget | null {
  if (t.kindId === "terminal") {
    const terminalId = (t.params as { terminalId?: string }).terminalId;
    if (typeof terminalId !== "string") return null;
    return { kind: "terminal", id: terminalId, workspaceId: t.workspaceId };
  }
  return { kind: "panel", id: t.panelId, workspaceId: t.workspaceId };
}

type SurfaceContext =
  | ToolbarItemContext["editor"]
  | ToolbarItemContext["panel"]
  | PanelTabMenuContext
  | MenuContext["editor/tab"]
  | MenuContext["terminal/tab"]
  | undefined;

/**
 * Which tab an invocation of the toggle/mark/clear commands acts on.
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
  workspaceFor: (kind: PanelKind, id: string) => string | undefined,
): PanelTarget | null {
  return fromArgs(args, workspaceFor) ?? fromActiveTab(active, workspaceFor);
}

function fromArgs(
  args: unknown[],
  workspaceFor: (kind: PanelKind, id: string) => string | undefined,
): PanelTarget | null {
  const t = args[0] as SurfaceContext;
  if (!t || typeof t !== "object") return null;
  if ("editorId" in t && typeof t.editorId === "string") {
    return withWorkspace("editor", t.editorId, workspaceFor);
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
    // the RFC 0039 "panel" toolbar strip — both carry workspaceId directly,
    // no lookup needed.
    return targetFromPanelContext(t as ToolbarItemContext["panel"]);
  }
  if ("terminalId" in t && typeof t.terminalId === "string") {
    // The terminal surfaces carry their own workspace id; a terminal can be
    // acted on from a workspace that isn't the active one.
    const workspaceId =
      "workspaceId" in t && typeof t.workspaceId === "string"
        ? t.workspaceId
        : workspaceFor("terminal", t.terminalId);
    if (!workspaceId) return null;
    return { kind: "terminal", id: t.terminalId, workspaceId };
  }
  return null;
}

function fromActiveTab(
  active: ActiveTab,
  workspaceFor: (kind: PanelKind, id: string) => string | undefined,
): PanelTarget | null {
  // Only one can be set: both report the single active center-dock panel.
  if (active.terminalId) {
    return withWorkspace("terminal", active.terminalId, workspaceFor);
  }
  if (active.editorId) {
    return withWorkspace("editor", active.editorId, workspaceFor);
  }
  return null;
}

function withWorkspace(
  kind: PanelKind,
  id: string,
  workspaceFor: (kind: PanelKind, id: string) => string | undefined,
): PanelTarget | null {
  const workspaceId = workspaceFor(kind, id);
  return workspaceId ? { kind, id, workspaceId } : null;
}
