import { useState } from "react";
import { Input, Section, SettingRow, Switch, Tabs, TabPanel } from "@silo-code/sdk";
import { useStore } from "../hooks";
import { sysmonStore } from "../store";
import type { PanelId, Settings } from "../store";
import { METRIC_REGISTRY } from "../registry";
import { DraggableSection } from "./DraggableSection";
import type { DraggableItem } from "./DraggableSection";

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

type ThresholdKey =
  | "cpuWarnPercent"
  | "cpuDangerPercent"
  | "memWarnMb"
  | "memDangerMb";

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

  function setThreshold(key: ThresholdKey, next: number) {
    if (!Number.isFinite(next) || next <= 0) return;
    sysmonStore.updateSettings({ ...settings, [key]: next });
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
    <div className="sms-settings-page">
      <h2 className="sms-settings-title">System Monitor</h2>
      <Tabs tabs={TABS} active={tab} onSelect={setTab} />
      <TabPanel>
        <div className="silo-scroll sms-settings-scroll">
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
            <Section label="Options">
              <SettingRow
                label="Workspace status"
                hint="Show CPU and memory warnings in the workspace status row and badge."
              >
                <Switch
                  checked={settings.workspaceStatus}
                  onChange={(next) =>
                    sysmonStore.updateSettings({ ...settings, workspaceStatus: next })
                  }
                  aria-label="Workspace status"
                />
              </SettingRow>
              <SettingRow
                label="CPU warning threshold"
                hint="Percent (per-core; summed across a workspace's sessions and their child processes for the badge)."
              >
                <Input
                  className="sm-threshold-input"
                  type="number"
                  min={1}
                  step={1}
                  value={settings.cpuWarnPercent}
                  onChange={(e) =>
                    setThreshold("cpuWarnPercent", Number(e.target.value))
                  }
                />
              </SettingRow>
              <SettingRow
                label="CPU danger threshold"
                hint="Percent — at or above this, the warning turns red."
              >
                <Input
                  className="sm-threshold-input"
                  type="number"
                  min={1}
                  step={1}
                  value={settings.cpuDangerPercent}
                  onChange={(e) =>
                    setThreshold("cpuDangerPercent", Number(e.target.value))
                  }
                />
              </SettingRow>
              <SettingRow
                label="Memory warning threshold"
                hint="MB, summed across a workspace's sessions and their child processes for the badge."
              >
                <Input
                  className="sm-threshold-input"
                  type="number"
                  min={1}
                  step={1}
                  value={settings.memWarnMb}
                  onChange={(e) =>
                    setThreshold("memWarnMb", Number(e.target.value))
                  }
                />
              </SettingRow>
              <SettingRow
                label="Memory danger threshold"
                hint="MB — at or above this, the warning turns red."
              >
                <Input
                  className="sm-threshold-input"
                  type="number"
                  min={1}
                  step={1}
                  value={settings.memDangerMb}
                  onChange={(e) =>
                    setThreshold("memDangerMb", Number(e.target.value))
                  }
                />
              </SettingRow>
            </Section>
          )}
        </div>
      </TabPanel>
    </div>
  );
}
