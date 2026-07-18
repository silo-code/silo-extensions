import { describe, it, expect, beforeEach } from "vitest";
import type { ExtensionStorage } from "@silo-code/sdk";
import {
  settingsService,
  initSettings,
  clearSettingsListeners,
  SOUND_IDS,
  type FocusBehavior,
} from "./settings-store";

/** In-memory ExtensionStorage stand-in, mirroring the host's real contract. */
function fakeStorage(
  initial: Record<string, unknown> = {},
): ExtensionStorage & {
  emit(): void;
} {
  const data = new Map<string, unknown>(Object.entries(initial));
  const listeners = new Set<() => void>();
  return {
    get: ((key: string, fallback?: unknown) =>
      data.has(key) ? data.get(key) : fallback) as ExtensionStorage["get"],
    set(key, value) {
      if (value === undefined) data.delete(key);
      else data.set(key, value);
    },
    keys: () => [...data.keys()],
    subscribe(listener) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    emit() {
      for (const l of listeners) l();
    },
  };
}

// settings-store.ts holds its state in a module-level singleton (mirrors the
// host's own ReactiveService pattern), so each test pins a known starting
// value via a throwaway storage before exercising the behavior under test.
function resetTo(focusBehavior: FocusBehavior) {
  clearSettingsListeners();
  initSettings(fakeStorage({ focusBehavior })).dispose();
}

describe("agent-monitor settings persistence", () => {
  beforeEach(() => {
    resetTo("none");
  });

  it("defaults to \"clear\" with empty storage", () => {
    resetTo("clear"); // restore module to compiled default before testing empty storage
    const storage = fakeStorage();
    const sub = initSettings(storage);
    expect(settingsService.getState().focusBehavior).toBe("clear");
    sub.dispose();
  });

  it("hydrates from a value already persisted (restart case)", () => {
    const storage = fakeStorage({ focusBehavior: "hide" });
    const sub = initSettings(storage);
    expect(settingsService.getState().focusBehavior).toBe("hide");
    sub.dispose();
  });

  it("coerces an invalid stored value to the default", () => {
    // e.g. a boolean left over from an older settings shape, or garbage.
    const storage = fakeStorage({ focusBehavior: true });
    const sub = initSettings(storage);
    expect(settingsService.getState().focusBehavior).toBe("clear");
    sub.dispose();
  });

  it("persists a change through settingsService.set", () => {
    const storage = fakeStorage();
    const sub = initSettings(storage);
    settingsService.set({ focusBehavior: "hide" });
    expect(storage.get<string>("focusBehavior")).toBe("hide");
    sub.dispose();
  });

  it("picks up a value that arrives after activation (async hydration)", () => {
    const storage = fakeStorage();
    const sub = initSettings(storage);
    expect(settingsService.getState().focusBehavior).toBe("none");
    storage.set("focusBehavior", "hide");
    storage.emit();
    expect(settingsService.getState().focusBehavior).toBe("hide");
    sub.dispose();
  });

  it("dispose stops reacting to further storage changes", () => {
    const storage = fakeStorage();
    const sub = initSettings(storage);
    sub.dispose();
    storage.set("focusBehavior", "hide");
    storage.emit();
    expect(settingsService.getState().focusBehavior).toBe("none");
  });
});

describe("agent-monitor sound settings", () => {
  beforeEach(() => {
    clearSettingsListeners();
    initSettings(fakeStorage({ soundEnabled: false, soundId: "chime" })).dispose();
  });

  it("defaults to enabled with \"chime\" when nothing is persisted", () => {
    const storage = fakeStorage();
    const sub = initSettings(storage);
    expect(settingsService.getState().soundEnabled).toBe(true);
    expect(settingsService.getState().soundId).toBe("chime");
    sub.dispose();
  });

  it("hydrates a persisted enabled/soundId pair", () => {
    const storage = fakeStorage({ soundEnabled: true, soundId: "sparkle" });
    const sub = initSettings(storage);
    expect(settingsService.getState().soundEnabled).toBe(true);
    expect(settingsService.getState().soundId).toBe("sparkle");
    sub.dispose();
  });

  it("coerces an invalid persisted soundId to the default", () => {
    const storage = fakeStorage({ soundId: "not-a-real-sound" });
    const sub = initSettings(storage);
    expect(settingsService.getState().soundId).toBe("chime");
    sub.dispose();
  });

  it.each(["press", "release", "toggle"])(
    "coerces the excluded UI-feedback sound %j to the default",
    (soundId) => {
      const storage = fakeStorage({ soundId });
      const sub = initSettings(storage);
      expect(settingsService.getState().soundId).toBe("chime");
      sub.dispose();
    },
  );

  it("coerces a non-boolean persisted soundEnabled to the default", () => {
    const storage = fakeStorage({ soundEnabled: "yes" });
    const sub = initSettings(storage);
    expect(settingsService.getState().soundEnabled).toBe(true);
    sub.dispose();
  });

  it("persists soundEnabled/soundId through settingsService.set", () => {
    const storage = fakeStorage();
    const sub = initSettings(storage);
    settingsService.set({ soundEnabled: true, soundId: "bloom" });
    expect(storage.get<boolean>("soundEnabled")).toBe(true);
    expect(storage.get<string>("soundId")).toBe("bloom");
    sub.dispose();
  });

  it("excludes the UI-feedback sounds from the offered list", () => {
    expect(SOUND_IDS).not.toContain("press");
    expect(SOUND_IDS).not.toContain("release");
    expect(SOUND_IDS).not.toContain("toggle");
    expect(SOUND_IDS).toContain("chime");
  });
});
