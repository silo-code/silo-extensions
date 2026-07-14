import { useState } from "react";
import { useStore } from "../hooks";
import { sysmonStore } from "../store";
import type { PanelId, Settings } from "../store";
import { METRIC_REGISTRY } from "../registry";
import { DraggableSection } from "./DraggableSection";
import type { DraggableItem } from "./DraggableSection";
import { Toggle } from "./Toggle";

type SettingsTab = "panels" | "statusBar" | "options";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "panels", label: "Side Panels" },
  { id: "statusBar", label: "Status Bar" },
  { id: "options", label: "Options" },
];

function reorder<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

function toItems(
  entries: { id: PanelId; enabled: boolean }[],
  hintKey: "panelHint" | "sbHint",
): DraggableItem[] {
  return entries.map((e) => {
    const m = METRIC_REGISTRY.find((r) => r.id === e.id);
    return {
      id: e.id,
      label: m?.label ?? e.id,
      hint: m?.[hintKey] ?? "",
      enabled: e.enabled,
    };
  });
}

export function SystemMonitorSettings() {
  const store = useStore();
  const { settings } = store;
  const [tab, setTab] = useState<SettingsTab>("panels");

  function toggle(
    key: keyof Pick<Settings, "panels" | "statusBar">,
    id: PanelId,
    next: boolean,
  ) {
    sysmonStore.updateSettings({
      ...settings,
      [key]: settings[key].map((p) =>
        p.id === id ? { ...p, enabled: next } : p,
      ),
    });
  }

  function reorderSection(
    key: keyof Pick<Settings, "panels" | "statusBar">,
    from: number,
    to: number,
  ) {
    sysmonStore.updateSettings({
      ...settings,
      [key]: reorder(settings[key], from, to),
    });
  }

  return (
    <div className="es-page">
      <div className="es-header">
        <h2>System Monitor</h2>
      </div>
      <div className="sms-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={"sms-tab" + (tab === t.id ? " sms-tab-active" : "")}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="es-scroll">
        {tab === "panels" && (
          <DraggableSection
            items={toItems(settings.panels, "panelHint")}
            onToggle={(id, next) => toggle("panels", id, next)}
            onReorder={(from, to) => reorderSection("panels", from, to)}
          />
        )}
        {tab === "statusBar" && (
          <DraggableSection
            items={toItems(settings.statusBar, "sbHint")}
            onToggle={(id, next) => toggle("statusBar", id, next)}
            onReorder={(from, to) => reorderSection("statusBar", from, to)}
          />
        )}
        {tab === "options" && (
          <section className="es-section">
            <div className="es-rows">
              <div className="es-row">
                <div className="es-row-text">
                  <span className="es-label">Workspace status</span>
                  <span className="es-hint">Show CPU and memory warnings in the workspace status row and badge.</span>
                </div>
                <div className="es-control">
                  <Toggle
                    label="Workspace status"
                    checked={settings.workspaceStatus}
                    onChange={(next) =>
                      sysmonStore.updateSettings({ ...settings, workspaceStatus: next })
                    }
                  />
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
