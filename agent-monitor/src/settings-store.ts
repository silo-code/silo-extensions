/**
 * The extension's own settings — a tiny reactive store implementing the SDK's
 * ReactiveService, mirroring the pattern used by the clock-extension example
 * (and, for the host's own settings pages, the terminal/editor settings
 * stores). `terminal-tracker.ts` and `index.tsx` read
 * `settingsService.getState()` when deciding what focusing a terminal does to
 * its status.
 *
 * Persisted via `ctx.storage.global` (shared across workspaces — this is a
 * general behavior preference, not per-project) so it survives an app
 * restart. `initSettings()` must be called once from `activate()`.
 *
 * Kept free of any *runtime* `@silo-code/sdk` import (types only) so this
 * module — and `settings.test.ts`, which exercises it directly — never needs
 * to load the SDK package at all. `settings.tsx` is the thin component layer
 * that adds the one runtime import (`useServiceState`).
 */

import type { ExtensionStorage, ReactiveService } from "@silo-code/sdk";

/**
 * What focusing an agent's terminal does to its status.
 *
 * - `"clear"` (default): viewing a finished terminal acknowledges the run —
 *   the green check and green status dot become the neutral grey "done" dot.
 * - `"hide"`: as `"clear"`, and additionally the workspace status row is
 *   hidden entirely for whichever terminal is currently focused.
 * - `"none"`: focus never changes status — the green finished indicator
 *   stays until the agent starts its next run.
 */
export type FocusBehavior = "clear" | "hide" | "none";

export interface AgentMonitorSettings {
  focusBehavior: FocusBehavior;
}

// Key renamed on each shape change ("hideStatusWhenFocused" → "clearOnFocus"
// → this) so stale persisted values from older versions are simply ignored
// and the new default applies.
const STORAGE_KEY = "focusBehavior";
const DEFAULT_BEHAVIOR: FocusBehavior = "clear";

const VALID_BEHAVIORS: readonly FocusBehavior[] = ["clear", "hide", "none"];

/** Guard against garbage in storage (or values from a future version). */
function coerceBehavior(v: unknown): FocusBehavior {
  return VALID_BEHAVIORS.includes(v as FocusBehavior)
    ? (v as FocusBehavior)
    : DEFAULT_BEHAVIOR;
}

let settings: AgentMonitorSettings = { focusBehavior: DEFAULT_BEHAVIOR };
let backingStorage: ExtensionStorage | null = null;
const listeners = new Set<(s: AgentMonitorSettings) => void>();

export const settingsService: ReactiveService<AgentMonitorSettings> & {
  set(patch: Partial<AgentMonitorSettings>): void;
} = {
  getState: () => settings,
  subscribe(listener) {
    listeners.add(listener);
    return { dispose: () => listeners.delete(listener) };
  },
  set(patch) {
    settings = { ...settings, ...patch };
    backingStorage?.set(STORAGE_KEY, settings.focusBehavior);
    for (const l of listeners) l(settings);
  },
};

/**
 * Bind persisted storage to the settings service — call once from
 * `activate()`. Reads the persisted value immediately and re-reads on every
 * storage change, since `ctx.storage` hydrates asynchronously and a value
 * saved last session may not be present at the instant `activate` runs.
 */
export function initSettings(storage: ExtensionStorage): {
  dispose(): void;
} {
  backingStorage = storage;
  function read() {
    const stored = coerceBehavior(
      storage.get<string>(STORAGE_KEY, settings.focusBehavior),
    );
    if (stored !== settings.focusBehavior) {
      settings = { ...settings, focusBehavior: stored };
      for (const l of listeners) l(settings);
    }
  }
  read();
  const sub = storage.subscribe(read);
  return { dispose: () => sub.dispose() };
}

export function clearSettingsListeners(): void {
  listeners.clear();
}
