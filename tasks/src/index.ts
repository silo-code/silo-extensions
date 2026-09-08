/**
 * `silo.tasks` — Silo-managed task lists.
 *
 * Phase 1: the Silo provider, a global + per-workspace list, a side panel, and
 * create/edit/complete/delete. Phase 2 adds the two **aggregating** surfaces
 * over the same one source set — the Navigator's cross-workspace **Tasks** view
 * and the **Tasks app** dock sheet.
 *
 * No permissions (`permissions: []`) — RFC 0032's sandbox lift means the
 * extension reaches its own storage directory through `ctx.files` with no
 * `fs:read` / `fs:write`.
 */

import { createElement } from "react";
import type {
  Extension,
  ExtensionContext,
  NavigatorViewProps,
  SidePanelProps,
} from "@silo-code/sdk";
import { ListChecks } from "@phosphor-icons/react";
import type { UnparsedLine } from "./providers/silo/jsonl";
import type { TaskSource } from "./model/source";
import { createProviderRegistry } from "./providers/registry";
import { SiloTaskProvider } from "./providers/silo/provider";
import { createSourceSet } from "./sources/source-set";
import { createPrefsStore, CROSS_SCOPE, SHEET_SCOPE } from "./lib/prefs";
import { viewMenu } from "./lib/menus";
import { collectLabels, type ViewPrefs } from "./lib/view";
import { createCommands } from "./commands";
import { createPanelBridge } from "./ui/panel-bridge";
import { TasksPanel } from "./ui/TasksPanel";
import { CrossTasksView } from "./ui/CrossTasksView";
import { TasksAppSheet } from "./ui/TasksAppSheet";
import styles from "./ui/tasks.css";

const STYLE_ID = "silo-tasks-styles";
const PANEL_ID = "silo.tasks.panel";
const VIEW_ID = "silo.tasks.cross";

function activate(ctx: ExtensionContext) {
  injectStyles();

  const providers = createProviderRegistry();
  const bridge = createPanelBridge();
  // The sheet gets its own handle so re-opening it for a second Navigator row
  // re-points the open sheet instead of stacking another.
  const sheetBridge = createPanelBridge();
  const prefsStore = createPrefsStore(ctx.storage.global);
  // The Navigator view and the sheet aggregate the same sources but keep their
  // arrange/filter/sort state on separate keys — the narrow rail and the
  // full-width sheet are arranged differently. Neither is ever a
  // `view:<workspaceId>` key.
  const crossPrefs = createPrefsStore(ctx.storage.global, CROSS_SCOPE);
  const sheetPrefs = createPrefsStore(ctx.storage.global, SHEET_SCOPE);
  ctx.subscriptions.push({ dispose: () => prefsStore.dispose() });
  ctx.subscriptions.push({ dispose: () => crossPrefs.dispose() });
  ctx.subscriptions.push({ dispose: () => sheetPrefs.dispose() });

  // The aggregated surfaces get no `SidePanelProps.hydrated`; app-state
  // hydration is the same flag the workspace store publishes.
  const setAggregatedHydration = (hydrated: boolean) => {
    crossPrefs.setHydrated(hydrated);
    sheetPrefs.setHydrated(hydrated);
  };
  setAggregatedHydration(ctx.workspaces.getState().hydrated);
  ctx.subscriptions.push(
    ctx.workspaces.subscribe((ws) => setAggregatedHydration(ws.hydrated)),
  );

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
    sheetBridge,
    revealPanel: () => ctx.layout.revealSidePanel(PANEL_ID),
    notify: (level, message) => ctx.ui.notify(level, message),
    logError: (message, err) => ctx.log.error(message, err),
    // `anchorPanelId` decides the column the sheet grows out of. It falls back
    // to the Tasks side panel: `panelId` reaches a Navigator view only on Silo
    // 0.65+, and `silo.engine` is informational — the host doesn't enforce it,
    // so an older app must degrade to a right-anchored sheet rather than
    // rejecting on an `undefined` id.
    openSheet: (target, anchorPanelId, opts) =>
      ctx.layout.openPanelSheet(
        anchorPanelId ?? PANEL_ID,
        () =>
          createElement(TasksAppSheet, {
            ctx,
            sourceSet,
            prefsStore: sheetPrefs,
            bridge: sheetBridge,
            initialTask: target
              ? { sourceId: target.sourceId, taskId: target.taskId }
              : null,
            focusComposerOnMount: opts?.focusComposer,
            focusSearchOnMount: opts?.focusSearch,
          }),
        {
          title: "Manage Tasks",
          width: 720,
          // "overlay" (the default) covers the center dock rather than
          // narrowing it — see design.md's R10 note for why this reverses
          // the original "push" call.
          mode: "overlay",
          className: "tasks-sheet",
        },
      ),
  });

  // The last panel the cross-workspace view was rendered in. A `"navigator"`
  // toolbar item's target is `{ viewId }` only (`ToolbarItemContext`), so the
  // "Manage tasks" button can't read this view's `panelId` the way a row click
  // can — we stash it here as the view renders and thread it through the
  // command, so the sheet grows out of whichever column the Navigator is
  // docked in rather than always the Tasks side panel.
  let navPanelId: string | undefined;

  // Registered after the commands: picking a row in the view hands the task off
  // to the Tasks app sheet. The Navigator is where you navigate *from* — paging
  // it into one task takes away the thing it is for, in the narrowest column in
  // the app.
  ctx.subscriptions.push(
    ctx.registerNavigatorView({
      id: VIEW_ID,
      title: "Tasks",
      // Match the other Navigator views (Workspaces' SquaresFour, Agents' Robot):
      // a list-with-checkmarks glyph at the same size/weight, not a lone filled box.
      icon: createElement(ListChecks, { size: 19, weight: "duotone" }),
      order: 20,
      component: (props: NavigatorViewProps) => {
        navPanelId = props.panelId;
        return createElement(CrossTasksView, {
          ...props,
          ctx,
          sourceSet,
          prefsStore: crossPrefs,
          onOpenTask: (
            sourceId: string,
            taskId: string,
            anchorPanelId: string | undefined,
          ) => commands.openApp({ sourceId, taskId }, anchorPanelId),
        });
      },
    }),
  );

  ctx.subscriptions.push(
    ctx.registerCommand({
      id: "silo.tasks.newInWorkspace",
      label: "Tasks: New task in the current workspace",
      run: (...args) => commands.newInWorkspace(...args),
    }),
    ctx.registerCommand({
      id: "silo.tasks.refresh",
      label: "Tasks: Refresh",
      run: () => commands.refresh(),
    }),
    ctx.registerCommand({
      id: "silo.tasks.open",
      label: "Tasks: Open Tasks app",
      // Anchor to the column the Navigator's Tasks view is docked in when it
      // has been rendered; `openApp` falls back to the Tasks side panel when
      // `navPanelId` is still undefined (palette use with the view never shown).
      // Opened deliberately (button / palette), not for a specific task, so the
      // caret lands in search.
      run: () =>
        commands.openApp(undefined, navPanelId, { focusSearch: true }),
    }),
    ctx.registerCommand({
      id: "silo.tasks.newInApp",
      label: "Tasks: New task in the Tasks app",
      // The Navigator view has no create row of its own — send the user to the
      // sheet's composer (expanded, title focused) instead of the side panel's
      // quick-add, which targets a different (active-workspace) list.
      run: () =>
        commands.openApp(undefined, navPanelId, { focusComposer: true }),
    }),
  );

  // The Navigator view owns the whole panel body, so its arrange / filter
  // controls are toolbar items in the host's view header (ADR 0038), scoped to
  // this view. They build the same menus over the same prefs the inline
  // toolbar in the side panel and the sheet does.
  const applyView = (next: Partial<ViewPrefs>) =>
    crossPrefs.setView({ ...crossPrefs.getState().view, ...next });
  const inThisView = (_keys: unknown, target: { viewId: string }) =>
    target.viewId === VIEW_ID;
  const crossLabels = () => {
    const state = sourceSet.getState();
    return collectLabels(
      state.sources.flatMap((s) => state.tasksBySource.get(s.id) ?? []),
    );
  };

  ctx.subscriptions.push(
    ctx.registerToolbarItem({
      id: "silo.tasks.nav.view",
      surface: "navigator",
      icon: "FunnelSimple",
      tooltip: "View options",
      label: "View options",
      order: 10,
      when: inThisView,
      // Group / sort / status / label / list, folded into one dropdown with
      // cascading submenus. Rebuilt on open, so labels and the list of open
      // workspaces are always current.
      menu: () =>
        viewMenu(
          crossPrefs.getState().view,
          crossLabels(),
          sourceSet.getState().sources,
          applyView,
        ),
    }),
    ctx.registerToolbarItem({
      id: "silo.tasks.nav.new",
      surface: "navigator",
      icon: "Plus",
      tooltip: "New task",
      label: "New task",
      order: 40,
      when: inThisView,
      // Opens the sheet and drops the cursor in its composer — the Navigator
      // view has no create row of its own, and the side panel's quick-add
      // targets a different list.
      command: "silo.tasks.newInApp",
    }),
    // R13: the view's own body hid its search box (too narrow to be worth
    // it beside the sheet's real one); this is how you reach the sheet — its
    // multiline rows, the Sort and List-filter dropdowns (R15), search, and
    // the composer's list picker for creating a task anywhere. Runs the
    // already-registered `silo.tasks.open` command, which anchors the sheet
    // to `navPanelId` — the column this view is docked in, captured as it
    // renders — since a `"navigator"` toolbar item's target is `{ viewId }`
    // only (`ToolbarItemContext["navigator"]`).
    ctx.registerToolbarItem({
      id: "silo.tasks.nav.openSheet",
      surface: "navigator",
      icon: "Rows",
      tooltip: "Manage tasks",
      label: "Manage tasks",
      order: 50,
      when: inThisView,
      command: "silo.tasks.open",
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
