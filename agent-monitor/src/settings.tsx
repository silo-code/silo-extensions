/**
 * The Agent Monitor settings page component. Split from `settings-store.ts`
 * so the pure store (and its unit tests) never has to load the real
 * `@silo-code/sdk` runtime — this file is the only place that does, via
 * `useServiceState`.
 */

import { useServiceState } from "@silo-code/sdk";
import { settingsService, type FocusBehavior } from "./settings-store";

export {
  settingsService,
  initSettings,
  clearSettingsListeners,
  type AgentMonitorSettings,
  type FocusBehavior,
} from "./settings-store";

interface RadioOptionProps {
  label: string;
  hint: string;
  checked: boolean;
  onSelect: () => void;
}

function RadioOption({ label, hint, checked, onSelect }: RadioOptionProps) {
  return (
    <label className="am-option">
      <input
        type="radio"
        name="am-focus-behavior"
        checked={checked}
        onChange={onSelect}
        aria-label={label}
      />
      <span className="am-option-dot" aria-hidden="true" />
      <span className="am-option-text">
        <span className="am-label">{label}</span>
        <span className="am-hint">{hint}</span>
      </span>
    </label>
  );
}

const FOCUS_OPTIONS: { value: FocusBehavior; label: string; hint: string }[] = [
  {
    value: "clear",
    label: "Clear the finished indicator",
    hint: "Viewing the terminal acknowledges the run — the green check disappears and the status dot turns grey.",
  },
  {
    value: "hide",
    label: "Clear it, and hide the focused terminal's status row",
    hint: "As above, plus the workspace status row is hidden entirely for whichever terminal you're currently viewing.",
  },
  {
    value: "none",
    label: "Keep it until the next run",
    hint: "Viewing changes nothing — the green check and status stay until the agent starts working again.",
  },
];

export function AgentMonitorSettingsPage() {
  const s = useServiceState(settingsService);
  return (
    <div className="am-page">
      <div className="am-header">
        <h2>Agent Monitor</h2>
      </div>
      <div className="am-section">
        <span className="am-section-title">
          When you view a finished agent's terminal
        </span>
        <span className="am-hint">
          An agent that finishes a run shows a green check on its tab and a
          green dot in the workspace status until you look at it. Choose what
          viewing its terminal should do.
        </span>
        <div className="am-options">
          {FOCUS_OPTIONS.map((opt) => (
            <RadioOption
              key={opt.value}
              label={opt.label}
              hint={opt.hint}
              checked={s.focusBehavior === opt.value}
              onSelect={() => settingsService.set({ focusBehavior: opt.value })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
