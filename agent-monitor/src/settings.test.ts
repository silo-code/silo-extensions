import { describe, it, expect, beforeEach } from "vitest";
import type { ExtensionStorage } from "@silo-code/sdk";
import {
  settingsService,
  initSettings,
  clearSettingsListeners,
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
