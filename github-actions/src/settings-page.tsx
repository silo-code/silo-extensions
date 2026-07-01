import { useState, useEffect } from "react";
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
    <div className="es-page">
      <div className="es-header">
        <h2>GitHub Actions</h2>
      </div>
      <div className="es-scroll">
        <section className="es-section">
          <h3 className="es-section-title">Authentication</h3>
          <div className="es-rows">
            <div className="es-row">
              <div className="es-row-text">
                <span className="es-label">GitHub CLI status</span>
                <span className="es-hint">Authentication is detected from the <code>gh</code> CLI</span>
              </div>
              <div className="es-control">
                {authState === "ok" && (
                  <span style={{ color: "var(--silo-color-ok)", fontWeight: 500 }}>✓ Authenticated</span>
                )}
                {authState === "unauthenticated" && (
                  <span style={{ color: "var(--silo-color-err)", fontWeight: 500 }}>✗ Not authenticated — run <code>gh auth login</code></span>
                )}
                {authState === "missing" && (
                  <span style={{ color: "var(--silo-color-err)", fontWeight: 500 }}>
                    ✗ gh CLI not installed —{" "}
                    <a href="https://cli.github.com" target="_blank" rel="noreferrer" style={{ color: "inherit" }}>
                      cli.github.com
                    </a>
                  </span>
                )}
                {authState === null && (
                  <span style={{ opacity: 0.5 }}>Checking...</span>
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
                <span className="es-hint">How often to check the active workspace for new runs</span>
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
                <span className="es-hint">How often to check background workspaces</span>
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
