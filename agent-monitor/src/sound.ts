/**
 * Plays the working → waiting notification sound, gated on the user's
 * settings and debounced so several terminals finishing at once don't stack
 * overlapping tones. Kept separate from `terminal-tracker.ts` so the
 * debounce logic is unit-testable without the SDK.
 */

import { play, type SoundName } from "cuelume";
import { settingsService } from "./settings-store";

const DEBOUNCE_MS = 750;
let lastPlayedAt = 0;

/** Called from `dispatch()` on every working → waiting attention transition. */
export function maybePlayTransitionSound(now: number = Date.now()): void {
  const { soundEnabled, soundId } = settingsService.getState();
  if (!soundEnabled) return;
  if (now - lastPlayedAt < DEBOUNCE_MS) return;
  lastPlayedAt = now;
  play(soundId);
}

/** Called from the settings page's preview button — bypasses the enabled
 * flag and debounce so every click is audible. */
export function previewSound(soundId: SoundName): void {
  play(soundId);
}
