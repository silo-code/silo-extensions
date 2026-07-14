import { useEffect } from "react";
import type { SidePanelProps } from "@silo-code/sdk";
import { useStore } from "../hooks";
import { getDescriptor } from "../registry";
import { processesController } from "../processes/controller";

export function SystemMonitorPanel({ active }: SidePanelProps) {
  const store = useStore();
  const { settings, live } = store;
  const visiblePanels = settings.panels.filter((p) => p.enabled);

  useEffect(() => {
    processesController.setPanelActive(active);
    return () => processesController.setPanelActive(false);
  }, [active]);

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
    </div>
  );
}
