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
    <div className="es-page">
      <div className="es-header">
        <h2>GitHub Pull Requests</h2>
      </div>
      <div className="es-scroll">
        <section className="es-section">
          <h3 className="es-section-title">Authentication</h3>
          <div className="es-rows">
            <div className="es-row">
              <div className="es-row-text">
                <span className="es-label">GitHub CLI status</span>
                <span className="es-hint">
                  Authentication is detected from the <code>gh</code> CLI
                </span>
              </div>
              <div className="es-control">
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
              </div>
            </div>
          </div>
        </section>

        <section className="es-section">
          <h3 className="es-section-title">Polling</h3>
          <div className="es-rows">
            <div className="es-row">
              <div className="es-row-text">
                <span className="es-label">Active workspace interval</span>
                <span className="es-hint">How often to refresh PRs for the active workspace</span>
              </div>
              <div className="es-control">
                <select
                  className="es-select"
                  value={settings.activePollIntervalMs}
                  onChange={(e) => update({ activePollIntervalMs: Number(e.target.value) })}
                >
                  <option value={30_000}>30 seconds</option>
                  <option value={60_000}>1 minute</option>
                  <option value={2 * 60_000}>2 minutes</option>
                  <option value={5 * 60_000}>5 minutes</option>
                </select>
              </div>
            </div>
            <div className="es-row">
              <div className="es-row-text">
                <span className="es-label">Inactive workspace interval</span>
                <span className="es-hint">How often to refresh background workspaces</span>
              </div>
              <div className="es-control">
                <select
                  className="es-select"
                  value={settings.inactivePollIntervalMs}
                  onChange={(e) => update({ inactivePollIntervalMs: Number(e.target.value) })}
                >
                  <option value={2 * 60_000}>2 minutes</option>
                  <option value={5 * 60_000}>5 minutes</option>
                  <option value={10 * 60_000}>10 minutes</option>
                  <option value={15 * 60_000}>15 minutes</option>
                </select>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
