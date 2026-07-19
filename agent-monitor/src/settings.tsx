/**
 * The Agent Monitor settings page component. Split from `settings-store.ts`
 * so the pure store (and its unit tests) never has to load the real
 * `@silo-code/sdk` runtime — this file is the only place that does, via
 * `useServiceState`.
 */

import {
  useServiceState,
  IconButton,
  RadioCard,
  RadioGroup,
  Select,
  SettingRow,
  Switch,
} from "@silo-code/sdk";
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

function soundLabel(name: SoundName): string {
  return name[0].toUpperCase() + name.slice(1);
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
          <RadioGroup
            value={s.focusBehavior}
            onChange={(value) =>
              settingsService.set({ focusBehavior: value as FocusBehavior })
            }
          >
            {FOCUS_OPTIONS.map((opt) => (
              <RadioCard
                key={opt.value}
                value={opt.value}
                title={opt.label}
                description={opt.hint}
              />
            ))}
          </RadioGroup>
        </div>
      </div>
      <div className="am-section">
        <span className="am-section-title">Sound</span>
        <span className="am-hint">
          Play a sound whenever an agent stops working, whether or not you're
          watching its terminal.
        </span>
        <SettingRow label="Play a sound when an agent stops working">
          <Switch
            checked={s.soundEnabled}
            onChange={(soundEnabled) => settingsService.set({ soundEnabled })}
            aria-label="Play a sound when an agent stops working"
          />
        </SettingRow>
        <SettingRow label="Notification sound">
          <div className="am-sound-control">
            <Select
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
            </Select>
            <IconButton
              size="sm"
              onClick={() => previewSound(s.soundId)}
              aria-label={`Preview ${soundLabel(s.soundId)} sound`}
            >
              ▶
            </IconButton>
          </div>
        </SettingRow>
      </div>
    </div>
  );
}
