import type {
  Disposable,
  Extension,
  ExtensionContext,
  TabHighlightBinder,
  ToolbarItemContext,
  WorkspaceStatusRow,
} from "@silo-code/sdk";
import {
  clear as clearMark,
  countMarks,
  isMarked,
  mark as setMark,
  parseMarks,
  pruneWorkspace,
  serializeMarks,
  statusLabel,
  toggle as toggleMark,
  type MarksState,
  type PanelKind,
} from "./store";
import {
  resolveTarget,
  targetFromPanelContext,
  type PanelTabMenuContext,
} from "./target";

const STORAGE_KEY = "marks";

/**
 * `ctx.panels` (RFC 0046 tab adornments for any dock panel kind) predates the
 * published SDK (`^0.48.0`) the same way `Workspace.panels` and the
 * "panel"/"panel/tab" surfaces did — read through a minimal local shape
 * (just the one verb this extension needs) rather than a real type import.
 */
interface CtxWithPanels {
  panels: {
    bindHighlight(binder: TabHighlightBinder): Disposable;
    invalidateTabAdornments(): void;
  };
}

function activate(ctx: ExtensionContext) {
  const panels = (ctx as unknown as CtxWithPanels).panels;
  let state: MarksState = parseMarks(ctx.storage.global.get(STORAGE_KEY));

  function persist() {
    ctx.storage.global.set(STORAGE_KEY, serializeMarks(state));
  }

  function invalidateChrome() {
    ctx.invalidateToolbarItems();
    ctx.editors.invalidateTabAdornments();
    ctx.terminals.invalidateTabAdornments();
    panels.invalidateTabAdornments();
    ctx.workspaces.invalidateStatus();
  }

  /**
   * `Workspace.panels` (RFC 0041 `DockPanelRecord[]`, extended by RFC 0046)
   * predates the published SDK (`^0.33.0`) the same way the "panel" toolbar
   * surface does — read through a minimal local shape rather than a real
   * type import. A panel's id in `panelId` form is `${kindId}:${id}`,
   * matching what `MenuContext["panel/tab"].panelId` already gives us, so
   * marks can be keyed on that string directly with no translation.
   */
  function livePanelIds(ws: unknown): Set<string> {
    const panels =
      (ws as { panels?: { id: string; kindId: string }[] }).panels ?? [];
    return new Set(panels.map((p) => `${p.kindId}:${p.id}`));
  }

  function findWorkspaceFor(kind: PanelKind, id: string): string | undefined {
    for (const ws of ctx.workspaces.getState().all) {
      if (kind === "editor") {
        if (ws.editors.some((e) => e.id === id)) return ws.id;
      } else if (kind === "terminal") {
        if (ws.terminals.some((t) => t.id === id)) return ws.id;
      } else if (livePanelIds(ws).has(id)) {
        return ws.id;
      }
    }
    return undefined;
  }

  function apply(
    workspaceId: string,
    kind: PanelKind,
    id: string,
    action: "toggle" | "mark" | "clear",
  ) {
    let changed = false;
    if (action === "toggle") changed = toggleMark(state, workspaceId, kind, id);
    else if (action === "mark") changed = setMark(state, workspaceId, kind, id);
    else changed = clearMark(state, workspaceId, kind, id);
    if (!changed) return;
    persist();
    invalidateChrome();
  }

  function runAction(action: "toggle" | "mark" | "clear") {
    return (...args: unknown[]) => {
      // Toolbar/context-menu invocations name their tab in args[0]; a
      // keybinding passes nothing and falls back to the active tab.
      const target = resolveTarget(
        args,
        {
          editorId: ctx.editors.getState().active?.editorId ?? null,
          terminalId: ctx.terminals.getActive(),
        },
        findWorkspaceFor,
      );
      if (!target) return;
      apply(target.workspaceId, target.kind, target.id, action);
    };
  }

  function pruneAll(): boolean {
    let changed = false;
    for (const ws of ctx.workspaces.getState().all) {
      const editors = new Set(ws.editors.map((e) => e.id));
      const terminals = new Set(ws.terminals.map((t) => t.id));
      const panels = livePanelIds(ws);
      if (pruneWorkspace(state, ws.id, editors, terminals, panels)) {
        changed = true;
      }
    }
    // Drop marks for workspaces that no longer exist.
    const liveWs = new Set(ctx.workspaces.getState().all.map((w) => w.id));
    for (const id of [...state.keys()]) {
      if (!liveWs.has(id)) {
        state.delete(id);
        changed = true;
      }
    }
    return changed;
  }

  // Hydrate / re-sync when global storage changes (e.g. another window — rare).
  ctx.subscriptions.push(
    ctx.storage.global.subscribe(() => {
      state = parseMarks(ctx.storage.global.get(STORAGE_KEY));
      invalidateChrome();
    }),
  );

  ctx.subscriptions.push(
    ctx.workspaces.subscribe(() => {
      if (pruneAll()) {
        persist();
        invalidateChrome();
      } else {
        // Panel list may have changed without pruning — status counts still
        // need a refresh when tabs open/close.
        ctx.workspaces.invalidateStatus();
      }
    }),
  );

  // Initial prune of stale ids from a prior session.
  if (pruneAll()) persist();

  ctx.subscriptions.push(
    ctx.registerCommand({
      id: "silo.follow-ups.toggle",
      label: "Follow-ups: Toggle",
      run: runAction("toggle"),
    }),
    ctx.registerCommand({
      id: "silo.follow-ups.mark",
      label: "Follow-ups: Mark as follow-up",
      run: runAction("mark"),
    }),
    ctx.registerCommand({
      id: "silo.follow-ups.clear",
      label: "Follow-ups: Clear follow-up",
      run: runAction("clear"),
    }),
  );

  ctx.subscriptions.push(
    ctx.registerToolbarItem({
      id: "silo.follow-ups.toolbar.editor",
      surface: "editor",
      command: "silo.follow-ups.toggle",
      icon: "Flag",
      tooltip: "Mark as follow-up",
      label: "Follow-up",
      checked: (_k, t) => {
        const ws = findWorkspaceFor("editor", t.editorId);
        return ws ? isMarked(state, ws, "editor", t.editorId) : false;
      },
    }),
    ctx.registerToolbarItem({
      id: "silo.follow-ups.toolbar.panel",
      // RFC 0039: every dock panel's toolbar (terminal included) lives on
      // the host-drawn "panel" strip. Unscoped (no `when`): it appears on
      // every panel tab, terminal or otherwise, same as the "panel/tab"
      // mark/clear context-menu items below.
      surface: "panel",
      command: "silo.follow-ups.toggle",
      icon: "Flag",
      tooltip: "Mark as follow-up",
      label: "Follow-up",
      checked: (_k, t: ToolbarItemContext["panel"]) => {
        const target = targetFromPanelContext(t);
        return target
          ? isMarked(state, target.workspaceId, target.kind, target.id)
          : false;
      },
    }),
  );

  ctx.subscriptions.push(
    ctx.registerContextMenuItem({
      surface: "editor/tab",
      command: "silo.follow-ups.mark",
      label: "Mark as follow-up",
      group: "follow-ups",
      when: (_k, t) => {
        const ws = findWorkspaceFor("editor", t.editorId);
        return ws ? !isMarked(state, ws, "editor", t.editorId) : false;
      },
    }),
    ctx.registerContextMenuItem({
      surface: "editor/tab",
      command: "silo.follow-ups.clear",
      label: "Clear follow-up",
      group: "follow-ups",
      when: (_k, t) => {
        const ws = findWorkspaceFor("editor", t.editorId);
        return ws ? isMarked(state, ws, "editor", t.editorId) : false;
      },
    }),
    ctx.registerContextMenuItem({
      surface: "terminal/tab",
      command: "silo.follow-ups.mark",
      label: "Mark as follow-up",
      group: "follow-ups",
      when: (_k, t) => {
        const ws = t.workspaceId || findWorkspaceFor("terminal", t.terminalId);
        return ws ? !isMarked(state, ws, "terminal", t.terminalId) : false;
      },
    }),
    ctx.registerContextMenuItem({
      surface: "terminal/tab",
      command: "silo.follow-ups.clear",
      label: "Clear follow-up",
      group: "follow-ups",
      when: (_k, t) => {
        const ws = t.workspaceId || findWorkspaceFor("terminal", t.terminalId);
        return ws ? isMarked(state, ws, "terminal", t.terminalId) : false;
      },
    }),
    // RFC 0046: every dock panel tab that isn't an editor or a terminal (a
    // Chat transcript, a web viewer, …) gets the same Mark/Clear pair on the
    // new "panel/tab" surface. The published SDK (^0.33.0) predates it, so —
    // same workaround as the "panel" toolbar item above — the surface
    // literal is cast to an existing one purely to satisfy the compiler; the
    // real string dispatched at runtime is still "panel/tab", and `t` is
    // re-cast to its actual shape (`PanelTabMenuContext`) inside each
    // callback.
    ctx.registerContextMenuItem({
      surface: "panel/tab" as "terminal/tab",
      command: "silo.follow-ups.mark",
      label: "Mark as follow-up",
      group: "follow-ups",
      when: (_k, t) => {
        const p = t as unknown as PanelTabMenuContext;
        return !isMarked(state, p.workspaceId, "panel", p.panelId);
      },
    }),
    ctx.registerContextMenuItem({
      surface: "panel/tab" as "terminal/tab",
      command: "silo.follow-ups.clear",
      label: "Clear follow-up",
      group: "follow-ups",
      when: (_k, t) => {
        const p = t as unknown as PanelTabMenuContext;
        return isMarked(state, p.workspaceId, "panel", p.panelId);
      },
    }),
  );

  ctx.subscriptions.push(
    ctx.editors.bindHighlight({
      id: "silo.follow-ups.tab-highlight",
      provide: (editorId) => {
        const ws = findWorkspaceFor("editor", editorId);
        if (!ws || !isMarked(state, ws, "editor", editorId)) return null;
        return { color: "warn" };
      },
    }),
    ctx.terminals.bindHighlight({
      id: "silo.follow-ups.tab-highlight",
      provide: (terminalId) => {
        const ws = findWorkspaceFor("terminal", terminalId);
        if (!ws || !isMarked(state, ws, "terminal", terminalId)) return null;
        return { color: "warn" };
      },
    }),
    panels.bindHighlight({
      id: "silo.follow-ups.tab-highlight",
      provide: (panelId) => {
        const ws = findWorkspaceFor("panel", panelId);
        if (!ws || !isMarked(state, ws, "panel", panelId)) return null;
        return { color: "warn" };
      },
    }),
  );

  ctx.subscriptions.push(
    ctx.workspaces.bindStatus({
      id: "silo.follow-ups.status",
      provide(workspaceId): WorkspaceStatusRow[] {
        const ws = ctx.workspaces.get(workspaceId);
        if (!ws) return [];
        const editors = new Set(ws.editors.map((e) => e.id));
        const terminals = new Set(ws.terminals.map((t) => t.id));
        const panels = livePanelIds(ws);
        const n = countMarks(state, workspaceId, editors, terminals, panels);
        if (n < 1) return [];
        return [
          {
            id: "follow-ups",
            activity: "warn",
            label: statusLabel(n),
          },
        ];
      },
    }),
  );
}

function deactivate() {}

export const extension: Extension = {
  id: "silo.follow-ups",
  activate,
  deactivate,
};
