import { Section, SettingRow, Select } from "@silo-code/sdk";
import type { ExtensionContext } from "@silo-code/sdk";
import { usePrStore } from "./hooks";
import type { PrSettings } from "./store";

export interface PrSettingsPageProps {
  ctx: ExtensionContext;
}

export function PrSettingsPage({ ctx }: PrSettingsPageProps) {
  const store = usePrStore();
  const settings = store.settings;
  const authState = store.authState;

  const update = (patch: Partial<PrSettings>) => store.updateSettings(patch);

  return (
    <div className="ghpr-settings-page">
      <h2 className="ghpr-settings-title">GitHub Pull Requests</h2>
      <div className="silo-scroll ghpr-settings-scroll">
        <Section label="Authentication">
          <SettingRow
            label="GitHub CLI status"
            hint="Authentication is detected from the gh CLI"
          >
            {authState === "ok" && (
              <span className="ghpr-settings-status ghpr-settings-status--ok">
                ✓ Authenticated
                {store.viewerLogin ? ` as ${store.viewerLogin}` : ""}
              </span>
            )}
            {authState === "unauthenticated" && (
              <span className="ghpr-settings-status ghpr-settings-status--err">
                ✗ Not authenticated — run <code>gh auth login</code>
              </span>
            )}
            {authState === "missing" && (
              <span className="ghpr-settings-status ghpr-settings-status--err">
                ✗ gh CLI not installed —{" "}
                <button
                  type="button"
                  className="ghpr-link"
                  onClick={() => void ctx.ui.openExternal("https://cli.github.com")}
                >
                  cli.github.com
                </button>
              </span>
            )}
            {(authState === null || authState === "deferred") && (
              <span className="ghpr-settings-status ghpr-settings-status--muted">
                Checking…
              </span>
            )}
          </SettingRow>
        </Section>

        <Section label="Polling">
          <SettingRow
            label="Active workspace interval"
            hint="How often to refresh PRs for the active workspace"
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
            hint="How often to refresh background workspaces"
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
