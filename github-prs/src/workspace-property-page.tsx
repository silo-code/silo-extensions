import { useEffect, useState } from "react";
import type { WorkspacePropertyPageProps } from "@silo-code/sdk";
import { FILTER_LABELS, PR_FILTERS, type PrFilter } from "./filters";
import type { PrService } from "./pr-service";
import { prStore } from "./store";

export interface PrWorkspaceSettingsProps extends WorkspacePropertyPageProps {
  service: PrService;
}

export function PrWorkspaceSettings({ ws, service }: PrWorkspaceSettingsProps) {
  const [, setTick] = useState(0);
  useEffect(() => prStore.subscribe(() => setTick((t) => t + 1)), []);

  const states = prStore.getRepoStates(ws.id);
  const hasRepo = states.some((s) => s.repoInfo !== null);
  const enabled = prStore.getWorkspaceEnabled(ws.id);
  const filter = prStore.getWorkspaceFilter(ws.id);

  if (!hasRepo) {
    return (
      <div className="ghpr-ws-props">
        <p className="ghpr-ws-props__hint">No GitHub repository detected for this workspace.</p>
      </div>
    );
  }

  function handleFilterChange(value: PrFilter) {
    prStore.setWorkspaceFilter(ws.id, value);
    if (value === "merged") {
      void service.refreshWorkspace(ws.id);
    }
  }

  return (
    <div className="ghpr-ws-props">
      <section className="ghpr-ws-props__section">
        <h3 className="ghpr-ws-props__title">Monitoring</h3>
        <label className="ghpr-ws-props__row">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => prStore.setWorkspaceEnabled(ws.id, e.target.checked)}
          />
          <span className="ghpr-ws-props__label">Monitor pull requests in this workspace</span>
        </label>
      </section>

      <section className="ghpr-ws-props__section">
        <h3 className="ghpr-ws-props__title">Default filter</h3>
        <select
          className="ghpr-ws-props__select"
          value={filter}
          onChange={(e) => handleFilterChange(e.target.value as PrFilter)}
        >
          {PR_FILTERS.map((f) => (
            <option key={f} value={f}>
              {FILTER_LABELS[f]}
            </option>
          ))}
        </select>
        <p className="ghpr-ws-props__hint">
          Which PRs the side panel shows by default for this workspace.
        </p>
      </section>

      {states.map(
        (state) =>
          state.repoInfo && (
            <section key={state.folder} className="ghpr-ws-props__section">
              <h3 className="ghpr-ws-props__title">
                {state.repoInfo.owner}/{state.repoInfo.repo}
              </h3>
              <p className="ghpr-ws-props__hint">
                {state.openPrs.length} open
                {state.mergedPrs.length > 0 ? ` · ${state.mergedPrs.length} recent merged` : ""}
              </p>
            </section>
          ),
      )}
    </div>
  );
}
