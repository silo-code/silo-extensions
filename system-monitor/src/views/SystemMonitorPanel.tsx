import { useEffect } from "react";
import {
  useServiceState,
  type ExtensionContext,
  type SidePanelProps,
} from "@silo-code/sdk";
import { useStore } from "../hooks";
import { getDescriptor } from "../registry";
import { processesController } from "../processes/controller";
import { openAllProcessesModal } from "./AllProcessesModal";

export function SystemMonitorPanel({
  active,
  ctx,
}: SidePanelProps & { ctx: ExtensionContext }) {
  const store = useStore();
  const { settings, live } = store;
  const visiblePanels = settings.panels.filter((p) => p.enabled);
  const wsState = useServiceState(ctx.workspaces);

  useEffect(() => {
    processesController.setPanelActive(active);
    return () => processesController.setPanelActive(false);
  }, [active]);

  // Match the core Git panel empty state when nothing is open — collectors
  // can't run without a workspace cwd, so don't show the PathDeniedError.
  if (!wsState.activeId) {
    return (
      <div className="sysmon">
        <div className="sm-empty">No active workspace.</div>
      </div>
    );
  }

  return (
    <div className="sysmon">
      <div className="sm-panels">
        {live.error ? (
          <div className="sm-error">{live.error}</div>
        ) : visiblePanels.length === 0 ? (
          <div
            style={{
              padding: "20px 14px",
              color: "var(--silo-color-text)",
              fontSize: "0.9em",
            }}
          >
            All panels hidden. Open Settings to re-enable them.
          </div>
        ) : (
          visiblePanels.map((p) => {
            const descriptor = getDescriptor(p.id);
            if (!descriptor?.PanelComponent) return null;
            const { PanelComponent } = descriptor;
            return <PanelComponent key={p.id} live={live} />;
          })
        )}
      </div>
      <button
        className="sm-footer-link"
        onClick={() => void openAllProcessesModal()}
      >
        All processes…
      </button>
    </div>
  );
}
