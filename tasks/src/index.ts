/**
 * `silo.tasks` — Silo-managed task lists. Phase 1: the Silo provider only, a
 * global + per-workspace list, a side panel, and create/edit/complete/delete.
 * No permissions (`permissions: []`) — RFC 0032's sandbox lift means the
 * extension reaches its own storage directory through `ctx.files` with no
 * `fs:read` / `fs:write`.
 */

import { createElement } from "react";
import type { Extension, ExtensionContext, SidePanelProps } from "@silo-code/sdk";
import type { UnparsedLine } from "./providers/silo/jsonl";
import type { TaskSource } from "./model/source";
import { createProviderRegistry } from "./providers/registry";
import { SiloTaskProvider } from "./providers/silo/provider";
import { createSourceSet } from "./sources/source-set";
import { createPrefsStore } from "./lib/prefs";
import { createCommands } from "./commands";
import { createPanelBridge } from "./ui/panel-bridge";
import { TasksPanel } from "./ui/TasksPanel";
import styles from "./ui/tasks.css";

const STYLE_ID = "silo-tasks-styles";
const PANEL_ID = "silo.tasks.panel";

function activate(ctx: ExtensionContext) {
  injectStyles();

  const providers = createProviderRegistry();
  const bridge = createPanelBridge();
  const prefsStore = createPrefsStore(ctx.storage.global);
  ctx.subscriptions.push({ dispose: () => prefsStore.dispose() });

  // One notice per source per distinct set of unparsed lines — a watched file
  // the user is mid-repair doesn't toast on every keystroke.
  const reportedBad = new Map<string, string>();
  function onDiagnostics(source: TaskSource, unparsed: readonly UnparsedLine[]) {
    if (unparsed.length === 0) {
      reportedBad.delete(source.id);
      return;
    }
    const sig = unparsed.map((u) => `${u.index}:${u.line}`).join("\n");
    if (reportedBad.get(source.id) === sig) return;
    reportedBad.set(source.id, sig);
    ctx.log.warn(`Unparsable lines in ${source.locator}`, { count: unparsed.length });
    ctx.ui.notify(
      "warn",
      `${unparsed.length} line${unparsed.length === 1 ? "" : "s"} in ${
        source.name
      }'s task file couldn't be read — open ${source.locator} to fix.`,
    );
  }

  providers.register(
    new SiloTaskProvider(ctx.files, { debounceMs: 150 }, onDiagnostics),
  );

  const sourceSet = createSourceSet(ctx, providers);
  ctx.subscriptions.push({ dispose: () => sourceSet.dispose() });
  void sourceSet.start();

  ctx.subscriptions.push(
    ctx.registerSidePanel({
      id: PANEL_ID,
      location: "right",
      title: "Tasks",
      lazyMount: true,
      component: (props: SidePanelProps) =>
        createElement(TasksPanel, {
          ...props,
          ctx,
          sourceSet,
          prefsStore,
          bridge,
        }),
    }),
  );

  const commands = createCommands({
    sourceSet,
    bridge,
    revealPanel: () => ctx.layout.revealSidePanel(PANEL_ID),
    notify: (level, message) => ctx.ui.notify(level, message),
  });

  ctx.subscriptions.push(
    ctx.registerCommand({
      id: "silo.tasks.new",
      label: "Tasks: New task",
      run: (...args) => commands.newTask(...args),
    }),
    ctx.registerCommand({
      id: "silo.tasks.newInGlobal",
      label: "Tasks: New task in personal list",
      run: (...args) => commands.newInGlobal(...args),
    }),
    ctx.registerCommand({
      id: "silo.tasks.refresh",
      label: "Tasks: Refresh",
      run: () => commands.refresh(),
    }),
    ctx.registerCommand({
      id: "silo.tasks.complete",
      label: "Tasks: Complete task",
      run: (...args) => commands.complete(...args),
    }),
  );
}

function deactivate() {
  document.getElementById(STYLE_ID)?.remove();
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = styles;
  document.head.appendChild(style);
}

export const extension: Extension = {
  id: "silo.tasks",
  manifest: {
    name: "Tasks",
    description:
      "Silo-managed task lists — a global personal list and one per workspace.",
    publisher: "Silo",
  },
  activate,
  deactivate,
};
