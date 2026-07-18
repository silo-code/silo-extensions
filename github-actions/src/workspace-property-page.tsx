import { useEffect, useState } from "react";
import type { WorkspacePropertyPageProps } from "@silo-code/sdk";
import type { GhActionsService } from "./gh-actions-service";
import { ghStore, formatBranchList, monitoredBranches } from "./store";
import { formatElapsed } from "./format-elapsed";

// The workspace-properties-modal tab (RFC 0015). Registered via
// ctx.workspaces.registerPropertyPage in index.tsx, which wraps this with the
// GhActionsService instance closed over — the SDK's WorkspacePropertyPageProps
// contract only hands us {ws, workspaces, refresh}, and the branch-only toggle
// needs a workspace-scoped refresh (GhActionsService.refreshWorkspace) that
// isn't reachable through those alone.
//
// The `visible` predicate this is registered with already hides the tab when
// no repo is detected, so the empty-state branch below is defense in depth
// (a render racing a repo-detection flip), not something users normally see.

interface Props extends WorkspacePropertyPageProps {
  service: GhActionsService;
}

export function GhActionsWorkspaceSettings({ ws, service }: Props) {
  const [, setTick] = useState(0);
  useEffect(() => ghStore.subscribe(() => setTick((t) => t + 1)), []);

  const states = ghStore.getRepoStates(ws.id);
  const hasRepo = states.some((s) => s.repoInfo !== null);
  const enabled = ghStore.getWorkspaceEnabled(ws.id);
  const branchOnly = ghStore.getWorkspaceCurrentBranchOnly(ws.id);
  const dismissOnSuccess = ghStore.getWorkspaceDismissOnSuccess(ws.id);
  const clearedAt = ghStore.getClearedAt(ws.id);

  if (!hasRepo) {
    return (
      <div className="gha-ws-props">
        <p className="gha-ws-props__hint">No GitHub repository detected for this workspace.</p>
      </div>
    );
  }

  async function handleToggleBranchOnly(value: boolean) {
    ghStore.setWorkspaceCurrentBranchOnly(ws.id, value);
    ghStore.clearWorkspaceRuns(ws.id);
    await service.refreshWorkspace(ws.id);
  }

  return (
    <div className="gha-ws-props">
      <section className="gha-ws-props__section">
        <h3 className="gha-ws-props__title">Monitoring</h3>
        <label className="gha-ws-props__row">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => ghStore.setWorkspaceEnabled(ws.id, e.target.checked)}
          />
          <span className="gha-ws-props__label">Monitor this workspace</span>
        </label>
        <label className="gha-ws-props__row">
          <input
            type="checkbox"
            checked={branchOnly}
            onChange={(e) => void handleToggleBranchOnly(e.target.checked)}
          />
          <span className="gha-ws-props__label">Only monitor checked-out branches</span>
        </label>
        <label className="gha-ws-props__row">
          <input
            type="checkbox"
            checked={dismissOnSuccess}
            onChange={(e) => ghStore.setWorkspaceDismissOnSuccess(ws.id, e.target.checked)}
          />
          <span className="gha-ws-props__label">Auto-dismiss alerts when workflows pass</span>
        </label>
      </section>

      <section className="gha-ws-props__section">
        <h3 className="gha-ws-props__title">Alerts</h3>
        {clearedAt ? (
          <p className="gha-ws-props__status">All alerts cleared {formatElapsed(clearedAt)}.</p>
        ) : (
          <p className="gha-ws-props__status">No alerts.</p>
        )}
        <button className="gha-btn" onClick={() => ghStore.clearAlerts(ws.id)}>
          Clear alerts
        </button>
      </section>

      {states.map(
        (state) =>
          state.repoInfo && (
            <section key={`${state.repoInfo.owner}/${state.repoInfo.repo}`} className="gha-ws-props__section">
              <h3 className="gha-ws-props__title">
                {state.repoInfo.owner}/{state.repoInfo.repo}
              </h3>
              <p className="gha-ws-props__hint">
                Branches: <code>{formatBranchList(monitoredBranches(state)) || "—"}</code>
              </p>
            </section>
          ),
      )}
    </div>
  );
}
