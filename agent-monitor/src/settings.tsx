/**
 * The Agent Monitor settings page component. Split from `settings-store.ts`
 * so the pure store (and its unit tests) never has to load the real
 * `@silo-code/sdk` runtime — this file is the only place that does, via
 * `useServiceState`.
 */

import { useServiceState } from "@silo-code/sdk";
import { settingsService } from "./settings-store";

export {
  settingsService,
  initSettings,
  clearSettingsListeners,
  type AgentMonitorSettings,
} from "./settings-store";

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="am-row">
      <div className="am-row-text">
        <span className="am-label">{label}</span>
        <span className="am-hint">{hint}</span>
      </div>
      <label className="am-switch">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.currentTarget.checked)}
          aria-label={label}
        />
        <span className="am-switch-track" />
      </label>
    </div>
  );
}

export function AgentMonitorSettingsPage() {
  const s = useServiceState(settingsService);
  return (
    <div className="am-page">
      <div className="am-header">
        <h2>Agent Monitor</h2>
      </div>
      <div className="am-list">
        <ToggleRow
          label="Hide status when terminal is focused"
          hint="Suppress the working/attention row and tab badge for whichever terminal you're currently viewing."
          checked={s.hideStatusWhenFocused}
          onChange={(v) => settingsService.set({ hideStatusWhenFocused: v })}
        />
      </div>
    </div>
  );
}
