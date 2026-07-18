/**
 * The Agent Monitor settings page component. Split from `settings-store.ts`
 * so the pure store (and its unit tests) never has to load the real
 * `@silo-code/sdk` runtime — this file is the only place that does, via
 * `useServiceState`.
 */

import { useServiceState } from "@silo-code/sdk";
import type { SoundName } from "./synth";
import { settingsService, SOUND_IDS, type FocusBehavior } from "./settings-store";
import { previewSound } from "./sound";

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

function soundLabel(name: SoundName): string {
  return name[0].toUpperCase() + name.slice(1);
}

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

// Mirrors the host's own Terminal settings page Toggle (`.es-switch` /
// `.es-switch-track` are host-provided design-system classes, no CSS import
// needed) so this page reads as one family with the host's settings UI.
function Toggle({ checked, onChange, label }: ToggleProps) {
  return (
    <label className="es-switch">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
      />
      <span className="es-switch-track" />
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
      <div className="am-section">
        <span className="am-section-title">Sound</span>
        <span className="am-hint">
          Play a sound whenever an agent stops working, whether or not you're
          watching its terminal.
        </span>
        <div className="es-rows">
          <div className="es-row">
            <div className="es-row-text">
              <span className="es-label">
                Play a sound when an agent stops working
              </span>
            </div>
            <div className="es-control">
              <Toggle
                label="Play a sound when an agent stops working"
                checked={s.soundEnabled}
                onChange={(soundEnabled) => settingsService.set({ soundEnabled })}
              />
            </div>
          </div>
          <div className="es-row">
            <div className="es-row-text">
              <span className="es-label">Notification sound</span>
            </div>
            <div className="es-control am-sound-control">
              <select
                className="es-select"
                value={s.soundId}
                onChange={(e) =>
                  settingsService.set({ soundId: e.target.value as SoundName })
                }
                aria-label="Notification sound"
              >
                {SOUND_IDS.map((name) => (
                  <option key={name} value={name}>
                    {soundLabel(name)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="am-preview-btn"
                onClick={() => previewSound(s.soundId)}
                aria-label={`Preview ${soundLabel(s.soundId)} sound`}
              >
                ▶
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
