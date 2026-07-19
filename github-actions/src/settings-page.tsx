import { useState, useEffect } from "react";
import { Section, SettingRow, Select } from "@silo-code/sdk";
import type { ExtensionContext } from "@silo-code/sdk";
import { ghStore, type GhActionsSettings } from "./store";
import type { AuthState } from "./github-api";

interface Props {
  ctx: ExtensionContext;
}

export function GhActionsSettings({ ctx: _ctx }: Props) {
  const [settings, setSettings] = useState<GhActionsSettings>(() => ghStore.settings);
  const [authState, setAuthState] = useState<AuthState | null>(() => ghStore.authState);

  useEffect(() => {
    return ghStore.subscribe(() => {
      setSettings(ghStore.settings);
      setAuthState(ghStore.authState);
    });
  }, []);

  const update = (patch: Partial<GhActionsSettings>) => ghStore.updateSettings(patch);

  return (
    <div className="gha-settings-page">
      <h2 className="gha-settings-title">GitHub Actions</h2>
      <div className="silo-scroll gha-settings-scroll">
        <Section label="Authentication">
          <SettingRow
            label="GitHub CLI status"
            hint="Authentication is detected from the gh CLI"
          >
            {authState === "ok" && (
              <span className="gha-settings-status gha-settings-status--ok">
                ✓ Authenticated
              </span>
            )}
            {authState === "unauthenticated" && (
              <span className="gha-settings-status gha-settings-status--err">
                ✗ Not authenticated — run <code>gh auth login</code>
              </span>
            )}
            {authState === "missing" && (
              <span className="gha-settings-status gha-settings-status--err">
                ✗ gh CLI not installed —{" "}
                <a href="https://cli.github.com" target="_blank" rel="noreferrer" className="gha-settings-link">
                  cli.github.com
                </a>
              </span>
            )}
            {(authState === null || authState === "deferred") && (
              <span className="gha-settings-status gha-settings-status--muted">
                Checking…
              </span>
            )}
          </SettingRow>
        </Section>

        <Section label="Polling">
          <SettingRow
            label="Active workspace interval"
            hint="How often to check the active workspace for new runs"
          >
            <Select
              value={settings.activePollIntervalMs}
              onChange={(e) => update({ activePollIntervalMs: Number(e.target.value) })}
            >
              <option value={30_000}>30 seconds</option>
              <option value={60_000}>1 minute</option>
              <option value={2 * 60_000}>2 minutes</option>
              <option value={5 * 60_000}>5 minutes</option>
            </Select>
          </SettingRow>
          <SettingRow
            label="Inactive workspace interval"
            hint="How often to check background workspaces"
          >
            <Select
              value={settings.inactivePollIntervalMs}
              onChange={(e) => update({ inactivePollIntervalMs: Number(e.target.value) })}
            >
              <option value={2 * 60_000}>2 minutes</option>
              <option value={5 * 60_000}>5 minutes</option>
              <option value={10 * 60_000}>10 minutes</option>
              <option value={15 * 60_000}>15 minutes</option>
            </Select>
          </SettingRow>
        </Section>
      </div>
    </div>
  );
}
