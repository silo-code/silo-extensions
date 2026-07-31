import type {
  Activity,
  Extension,
  ExtensionContext,
  WorkspaceStatusRow,
} from "@silo-code/sdk";
import { createTerminalTracker } from "./terminal-tracker";
import {
  deriveStatusRow,
  deriveTabBadge,
  stripStatusMarker,
  staleSuffix,
  isSuppressedByFocus,
  type TabBadge,
} from "./agent-status";
import {
  initSettings,
  clearSettingsListeners,
  AgentMonitorSettingsPage,
  settingsService,
} from "./settings";
import styles from "./styles.css";

const STYLE_ID = "silo-agent-monitor-styles";

function tabBadgeToActivity(badge: TabBadge): Activity {
  switch (badge) {
    case "working":
      return "working";
    case "attention":
      return "ready";
    case "waiting":
      return "warn";
    case "error":
      return "error";
  }
}

function tabBadgeTooltip(badge: TabBadge): string {
  switch (badge) {
    case "working":
      return "Agent working";
    case "attention":
      return "Finished";
    case "waiting":
      return "Waiting for input";
    case "error":
      return "Error";
  }
}

function activate(ctx: ExtensionContext) {
  ctx.subscriptions.push(initSettings(ctx.storage.global));

  const tracker = createTerminalTracker(ctx);
  ctx.subscriptions.push({ dispose: tracker.dispose });

  ctx.subscriptions.push(
    ctx.workspaces.bindStatus({
      id: "silo.agent-monitor.status",
      provide(workspaceId): WorkspaceStatusRow[] {
        const ws = ctx.workspaces.get(workspaceId);
        if (!ws) return [];
        const rows: WorkspaceStatusRow[] = [];
        const hideFocusedRow = settingsService.getState().focusBehavior === "hide";
        for (const t of ws.terminals) {
          const s = tracker.states.get(t.id);
          if (!s) continue;
          if (isSuppressedByFocus(hideFocusedRow, t.id, tracker.activeTerminalId)) continue;
          const row = deriveStatusRow(s);
          if (!row) continue;
          const label = t.customName ?? stripStatusMarker(t.title);
          rows.push({
            id: t.id,
            // Restored from a prior session after a long-enough app-closed
            // gap that the agent may have already finished without us
            // observing it — flag the duration as unconfirmed rather than
            // silently show it as if freshly confirmed.
            label: `${label}${staleSuffix(s, "label")}`,
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
        const s = tracker.states.get(terminalId);
        if (!s) return null;
        const badge = deriveTabBadge(s);
        if (!badge) return null;
        return {
          activity: tabBadgeToActivity(badge),
          tooltip: `${tabBadgeTooltip(badge)}${staleSuffix(s, "tooltip")}`,
        };
      },
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
