import type {
  Extension,
  ExtensionContext,
  TerminalTabDecoration,
  WorkspaceStatusRow,
} from "@silo-code/sdk";
import { createTerminalTracker } from "./terminal-tracker";
import { deriveStatusRow, deriveTabBadge, stripStatusMarker, staleSuffix } from "./agent-status";
import {
  initSettings,
  clearSettingsListeners,
  AgentMonitorSettingsPage,
} from "./settings";
import styles from "./styles.css";

const STYLE_ID = "silo-agent-monitor-styles";

function activate(ctx: ExtensionContext) {
  ctx.subscriptions.push(initSettings(ctx.storage.global));

  const tracker = createTerminalTracker(ctx);
  ctx.subscriptions.push({ dispose: tracker.dispose });

  ctx.subscriptions.push(
    ctx.workspaces.registerStatus({
      id: "silo.agent-monitor.status",
      provide(workspaceId): WorkspaceStatusRow[] {
        const ws = ctx.workspaces.get(workspaceId);
        if (!ws) return [];
        const rows: WorkspaceStatusRow[] = [];
        for (const t of ws.terminals) {
          const s = tracker.states.get(t.id);
          if (!s) continue;
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
            status: row.status,
            startedAt: row.startedAt,
          });
        }
        return rows;
      },
    }),
  );

  ctx.subscriptions.push(
    ctx.terminals.registerTabDecoration({
      id: "silo.agent-monitor.tab",
      provide(terminalId): TerminalTabDecoration | null {
        const s = tracker.states.get(terminalId);
        if (!s) return null;
        const tooltipSuffix = staleSuffix(s, "tooltip");
        switch (deriveTabBadge(s)) {
          case "working":
            return {
              icon: <SpinnerIcon />,
              color: "accent",
              tooltip: `Agent working${tooltipSuffix}`,
            };
          case "attention":
            return {
              icon: <AttentionIcon />,
              color: "warn",
              tooltip: `Needs attention${tooltipSuffix}`,
            };
          case "waiting":
            return {
              icon: <WaitingIcon />,
              color: "muted",
              tooltip: "Waiting for input",
            };
          case "done":
            return { icon: <DoneIcon />, color: "ok", tooltip: "Done" };
          case "error":
            return { icon: <ErrorIcon />, color: "error", tooltip: "Error" };
          default:
            return null;
        }
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

function SpinnerIcon() {
  return <div className="am-spinner" aria-hidden="true" />;
}
function AttentionIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M6 1a3.2 3.2 0 0 0-3.2 3.2v2.1L1.7 8.3a.5.5 0 0 0 .42.77h7.76a.5.5 0 0 0 .42-.77L9.2 6.3V4.2A3.2 3.2 0 0 0 6 1z" />
      <path d="M4.8 9.9a1.2 1.2 0 0 0 2.4 0z" />
    </svg>
  );
}
function WaitingIcon() {
  return (
    <div className="am-waiting-icon" aria-hidden="true">
      <span />
      <span />
    </div>
  );
}
function DoneIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        d="M10 3L5 9 2 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
function ErrorIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M6 1a5 5 0 1 0 0 10A5 5 0 0 0 6 1zm-.5 2.5h1v4h-1v-4zm0 5h1v1h-1v-1z" />
    </svg>
  );
}

export const extension: Extension = {
  id: "silo.agent-monitor",
  activate,
  deactivate,
};
