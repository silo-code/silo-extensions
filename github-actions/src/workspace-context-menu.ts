import type { Disposable, ExtensionContext, Workspace } from "@silo-code/sdk";
import type { GhActionsService } from "./gh-actions-service";
import type { WorkspaceGhState } from "./store";
import { ghStore } from "./store";

// Workspace row context-menu contributions (RFC 0013 "workspace" surface,
// RFC 0015's worked example). Refresh/Clear Alerts are two `when`-gated
// commands — one-shot actions. Enable/disable is a single command with a
// `checked` predicate (RFC 0013's toggle-row addition), not two
// mutually-exclusive commands, since it represents persistent on/off state.
//
// The `when`/`checked` predicates delegate to pure functions over
// WorkspaceGhState[] (same shape as store.ts's selectFailedRuns etc.) rather
// than closing over ghStore directly, so they're unit-testable without a
// store instance.

/** True if any of a workspace's detected folders resolved a GitHub remote. */
export function hasDetectedRepo(states: WorkspaceGhState[]): boolean {
  return states.some((s) => s.repoInfo !== null);
}

/** True if any detected repo has at least one failed (not necessarily unseen) run. */
export function hasFailedRuns(states: WorkspaceGhState[]): boolean {
  return states.some(
    (s) => s.repoInfo !== null && s.runs.some((r) => r.conclusion === "failure"),
  );
}

// Command.run is `(...args: unknown[])` — dispatch from a context-menu click
// hands the surface's target (here, the clicked Workspace) as args[0]. There
// is no other caller of these three ids, so narrowing here is safe.
function asWorkspace(args: unknown[]): Workspace {
  return args[0] as Workspace;
}

export function registerWorkspaceContextMenu(
  ctx: ExtensionContext,
  service: GhActionsService,
): Disposable[] {
  return [
    ctx.registerCommand({
      id: "silo.github-actions.refresh-workspace",
      label: "GitHub Actions: Refresh",
      run: (...args) => service.refreshWorkspace(asWorkspace(args).id),
    }),
    ctx.registerCommand({
      id: "silo.github-actions.clear-alerts-workspace",
      label: "GitHub Actions: Clear Alerts",
      run: (...args) => ghStore.clearAlerts(asWorkspace(args).id),
    }),
    ctx.registerCommand({
      id: "silo.github-actions.toggle-enabled-workspace",
      label: "GitHub Actions: Enabled",
      run: (...args) => {
        const ws = asWorkspace(args);
        ghStore.setWorkspaceEnabled(ws.id, !ghStore.getWorkspaceEnabled(ws.id));
      },
    }),
    ctx.registerContextMenuItem({
      surface: "workspace",
      command: "silo.github-actions.refresh-workspace",
      label: "GitHub Actions: Refresh",
      group: "gh-actions",
      when: (_, ws) => hasDetectedRepo(ghStore.getRepoStates(ws.id)),
    }),
    ctx.registerContextMenuItem({
      surface: "workspace",
      command: "silo.github-actions.clear-alerts-workspace",
      label: "GitHub Actions: Clear Alerts",
      group: "gh-actions",
      when: (_, ws) => hasFailedRuns(ghStore.getRepoStates(ws.id)),
    }),
    ctx.registerContextMenuItem({
      surface: "workspace",
      command: "silo.github-actions.toggle-enabled-workspace",
      label: "GitHub Actions: Enabled",
      group: "gh-actions",
      when: (_, ws) => hasDetectedRepo(ghStore.getRepoStates(ws.id)),
      checked: (_, ws) => ghStore.getWorkspaceEnabled(ws.id),
    }),
  ];
}
