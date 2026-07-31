import type {
  AgentInfo,
  Extension,
  ExtensionContext,
  WorkspaceStatusRow,
} from "@silo-code/sdk";
import {
  deriveStatusRow,
  deriveTab,
  stripStatusMarker,
  staleSuffix,
  stoppedWorking,
} from "./agent-view";
import { maybePlayTransitionSound } from "./sound";
import {
  initSettings,
  clearSettingsListeners,
  AgentMonitorSettingsPage,
  settingsService,
} from "./settings";
import styles from "./styles.css";

const STYLE_ID = "silo-agent-monitor-styles";

function activate(ctx: ExtensionContext) {
  ctx.subscriptions.push(initSettings(ctx.storage.global));

  // Latest host-computed agent state, keyed by terminal record id. Since Silo
  // 0.39 the host (`ctx.agents`) owns every hard part — OSC detection, the
  // working/idle/dead state machine, cross-restart persistence, and stale-gap
  // recovery — so this extension only *projects* that shared state into rows,
  // tab badges, and a chime. The map is read synchronously by the two binder
  // `provide` callbacks below, so it's kept current on every agents change.
  const agents = new Map<string, AgentInfo>();
  // Terminals that have finished a run and not yet started another, mapped to
  // when they finished. This is the extension's own "finished, unseen" record,
  // used *only* by the "Keep it until the next run" focus mode: the host clears
  // (or never raises) `needsAttention` for a finish you were watching live, so
  // this local flag is what keeps such a finish green until the agent works
  // again. The `clear`/`hide` modes ignore it and rely on host `needsAttention`.
  const finishedUnseen = new Map<string, string>();
  let activeTerminalId = ctx.terminals.getActive();

  function applySnapshot(state: AgentInfo[]) {
    let ring = false;
    const next = new Map<string, AgentInfo>();
    const liveIds = new Set<string>();
    for (const a of state) {
      liveIds.add(a.terminalId);
      // Chime once when any agent finishes a run, whether or not its terminal
      // is focused — the host lands watched finishes straight on idle too, so
      // this covers both. maybePlayTransitionSound debounces simultaneous ones.
      if (stoppedWorking(agents.get(a.terminalId), a)) {
        ring = true;
        finishedUnseen.set(a.terminalId, new Date().toISOString());
      }
      // A new run clears the finished flag — "until the next run" ends here.
      if (a.activity === "working") finishedUnseen.delete(a.terminalId);
      next.set(a.terminalId, a);
    }
    // Drop flags for terminals the host no longer tracks (closed).
    for (const id of [...finishedUnseen.keys()]) {
      if (!liveIds.has(id)) finishedUnseen.delete(id);
    }
    agents.clear();
    for (const [id, a] of next) agents.set(id, a);
    if (ring) maybePlayTransitionSound();
    ctx.workspaces.invalidateStatus();
    ctx.terminals.invalidateTabDecorations();
  }

  ctx.subscriptions.push(
    ctx.agents.subscribe((state) => applySnapshot(state), {
      allWorkspaces: true,
    }),
  );
  // subscribe() only fires on change, so seed the current state now — the
  // first render must already have it. Seeding compares against an empty map,
  // so it never rings the chime.
  applySnapshot(ctx.agents.getState({ allWorkspaces: true }));

  ctx.subscriptions.push(
    ctx.workspaces.bindStatus({
      id: "silo.agent-monitor.status",
      provide(workspaceId): WorkspaceStatusRow[] {
        const ws = ctx.workspaces.get(workspaceId);
        if (!ws) return [];
        const rows: WorkspaceStatusRow[] = [];
        const behavior = settingsService.getState().focusBehavior;
        const hideFocusedRow = behavior === "hide";
        for (const t of ws.terminals) {
          const a = agents.get(t.id);
          if (!a) continue;
          if (hideFocusedRow && t.id === activeTerminalId) continue;
          // Only "none" mode holds a watched finish green (see finishedUnseen).
          const forcedSince =
            behavior === "none" ? finishedUnseen.get(t.id) : undefined;
          const row = deriveStatusRow(a, forcedSince);
          if (!row) continue;
          const label = t.customName ?? stripStatusMarker(t.title);
          rows.push({
            id: t.id,
            // A restored busy/attention duration the host couldn't confirm
            // after a long app-closed gap is flagged rather than shown as if
            // freshly observed.
            label: `${label}${staleSuffix(a.stale, "label")}`,
            activity: row.activity,
            startedAt: row.startedAt,
          });
        }
        return rows;
      },
    }),
  );

  ctx.subscriptions.push(
    ctx.terminals.bindActivity({
      id: "silo.agent-monitor.tab",
      provide(terminalId) {
        const a = agents.get(terminalId);
        if (!a) return null;
        const forceAttention =
          settingsService.getState().focusBehavior === "none" &&
          finishedUnseen.has(terminalId);
        const tab = deriveTab(a, forceAttention);
        if (!tab) return null;
        return { activity: tab.activity, tooltip: tab.tooltip };
      },
    }),
  );

  ctx.subscriptions.push(
    ctx.terminals.subscribeActive((terminalId) => {
      activeTerminalId = terminalId;
      // Viewing a terminal acknowledges a pending finish (clears the green
      // "needs attention" flag) — unless the user chose "none", where focus
      // never touches status. `acknowledge` is a host-side no-op when the
      // terminal wasn't pending, so calling it unconditionally is safe.
      if (terminalId && settingsService.getState().focusBehavior !== "none") {
        ctx.agents.acknowledge(terminalId);
      }
      // Re-render rows on every focus change so the "hide focused row" setting
      // tracks the active terminal even when the acknowledge above was a no-op.
      ctx.workspaces.invalidateStatus();
    }),
  );

  ctx.subscriptions.push(
    ctx.workspaces.subscribe(() => {
      // Terminal titles/customNames live on workspace state, so status-row
      // labels can change even when the agent state itself hasn't.
      ctx.workspaces.invalidateStatus();
    }),
  );

  ctx.subscriptions.push(
    settingsService.subscribe(() => {
      // Toggling "hide focused row" changes which rows render.
      ctx.workspaces.invalidateStatus();
    }),
  );

  // No group needed — the host groups non-core settings pages under Extensions.
  ctx.subscriptions.push(
    ctx.registerSettingsPage({
      id: "agent-monitor",
      title: "Agent Monitor",
      component: AgentMonitorSettingsPage,
    }),
  );

  injectStyles();
}

function deactivate() {
  document.getElementById(STYLE_ID)?.remove();
  clearSettingsListeners();
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = styles;
  document.head.appendChild(style);
}

export const extension: Extension = {
  id: "silo.agent-monitor",
  activate,
  deactivate,
};
