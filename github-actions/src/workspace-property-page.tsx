import { useEffect, useState } from "react";
import { Button, Section, SettingRow, Switch } from "@silo-code/sdk";
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
      <Section label="Monitoring">
        <SettingRow label="Monitor this workspace">
          <Switch
            checked={enabled}
            onChange={(v) => ghStore.setWorkspaceEnabled(ws.id, v)}
            aria-label="Monitor this workspace"
          />
        </SettingRow>
        <SettingRow label="Only monitor checked-out branches">
          <Switch
            checked={branchOnly}
            onChange={(v) => void handleToggleBranchOnly(v)}
            aria-label="Only monitor checked-out branches"
          />
        </SettingRow>
        <SettingRow label="Auto-dismiss alerts when workflows pass">
          <Switch
            checked={dismissOnSuccess}
            onChange={(v) => ghStore.setWorkspaceDismissOnSuccess(ws.id, v)}
            aria-label="Auto-dismiss alerts when workflows pass"
          />
        </SettingRow>
      </Section>

      <Section label="Alerts">
        <p className="gha-ws-props__status">
          {clearedAt ? `All alerts cleared ${formatElapsed(clearedAt)}.` : "No alerts."}
        </p>
        <Button onClick={() => ghStore.clearAlerts(ws.id)}>Clear alerts</Button>
      </Section>

      {states.map(
        (state) =>
          state.repoInfo && (
            <Section
              key={`${state.repoInfo.owner}/${state.repoInfo.repo}`}
              label={`${state.repoInfo.owner}/${state.repoInfo.repo}`}
            >
              <p className="gha-ws-props__hint">
                Branches: <code>{formatBranchList(monitoredBranches(state)) || "—"}</code>
              </p>
            </Section>
          ),
      )}
    </div>
  );
}
