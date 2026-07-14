import { describe, it, expect, vi } from "vitest";
import {
  mergeList,
  mergeSettings,
  mergeThreshold,
  DEFAULT_SETTINGS,
  sysmonStore,
} from "./store";
import type { PanelEntry, Settings } from "./store";
import type { ExtensionStorage } from "@silo-code/sdk";

describe("mergeList", () => {
  const defaults: PanelEntry[] = [
    { id: "cpu", enabled: true },
    { id: "memory", enabled: true },
  ];

  it("returns cloned defaults when saved is undefined", () => {
    const result = mergeList(undefined, defaults);
    expect(result).toEqual(defaults);
    expect(result).not.toBe(defaults);
  });

  it("returns cloned defaults when saved is not an array", () => {
    // @ts-expect-error — testing runtime resilience
    const result = mergeList("bad", defaults);
    expect(result).toEqual(defaults);
  });

  it("preserves saved enabled state", () => {
    const saved: PanelEntry[] = [
      { id: "cpu", enabled: false },
      { id: "memory", enabled: true },
    ];
    const result = mergeList(saved, defaults);
    expect(result.find((p) => p.id === "cpu")?.enabled).toBe(false);
    expect(result.find((p) => p.id === "memory")?.enabled).toBe(true);
  });

  it("preserves saved order", () => {
    const saved: PanelEntry[] = [
      { id: "memory", enabled: true },
      { id: "cpu", enabled: true },
    ];
    const result = mergeList(saved, defaults);
    expect(result[0].id).toBe("memory");
    expect(result[1].id).toBe("cpu");
  });

  it("drops unknown ids from saved", () => {
    const saved = [
      { id: "disk" as unknown as "cpu", enabled: true },
      { id: "cpu" as const, enabled: true },
    ];
    const result = mergeList(saved, defaults);
    expect(result.find((p) => p.id === ("disk" as never))).toBeUndefined();
    expect(result.find((p) => p.id === "cpu")).toBeDefined();
  });

  it("appends new defaults not present in saved", () => {
    const saved: PanelEntry[] = [{ id: "cpu", enabled: false }];
    // "memory" is in defaults but not saved — should appear at the end
    const result = mergeList(saved, defaults);
    expect(result.find((p) => p.id === "memory")).toBeDefined();
  });

  it("gains a 'processes' entry via mergeList for settings saved before it existed", () => {
    const saved = DEFAULT_SETTINGS.panels.filter((p) => p.id !== "processes");
    const result = mergeList(saved, DEFAULT_SETTINGS.panels);
    expect(result.find((p) => p.id === "processes")).toEqual({
      id: "processes",
      enabled: true,
    });
  });
});

describe("mergeThreshold", () => {
  it("keeps a valid positive number", () => {
    expect(mergeThreshold(42, 100)).toBe(42);
  });

  it("falls back for undefined", () => {
    expect(mergeThreshold(undefined, 100)).toBe(100);
  });

  it("falls back for zero or negative values", () => {
    expect(mergeThreshold(0, 100)).toBe(100);
    expect(mergeThreshold(-5, 100)).toBe(100);
  });

  it("falls back for NaN/Infinity", () => {
    expect(mergeThreshold(NaN, 100)).toBe(100);
    expect(mergeThreshold(Infinity, 100)).toBe(100);
  });

  it("falls back for a non-number", () => {
    expect(mergeThreshold("50", 100)).toBe(100);
  });
});

describe("mergeSettings", () => {
  it("returns valid Settings from an empty partial", () => {
    const result = mergeSettings({});
    expect(result.panels).toEqual(DEFAULT_SETTINGS.panels);
    expect(result.statusBar).toEqual(DEFAULT_SETTINGS.statusBar);
    expect(result.cpuWarnPercent).toBe(DEFAULT_SETTINGS.cpuWarnPercent);
    expect(result.cpuDangerPercent).toBe(DEFAULT_SETTINGS.cpuDangerPercent);
    expect(result.memWarnMb).toBe(DEFAULT_SETTINGS.memWarnMb);
    expect(result.memDangerMb).toBe(DEFAULT_SETTINGS.memDangerMb);
  });

  it("merges panels and statusBar independently", () => {
    const result = mergeSettings({
      panels: [
        { id: "cpu", enabled: false },
        { id: "memory", enabled: true },
      ],
    });
    // panels come from saved
    expect(result.panels.find((p) => p.id === "cpu")?.enabled).toBe(false);
    // statusBar falls back to defaults
    expect(result.statusBar).toEqual(DEFAULT_SETTINGS.statusBar);
  });

  it("preserves saved threshold overrides", () => {
    const result = mergeSettings({
      cpuWarnPercent: 30,
      cpuDangerPercent: 90,
      memWarnMb: 750,
      memDangerMb: 3000,
    });
    expect(result.cpuWarnPercent).toBe(30);
    expect(result.cpuDangerPercent).toBe(90);
    expect(result.memWarnMb).toBe(750);
    expect(result.memDangerMb).toBe(3000);
  });

  it("falls back to defaults for an invalid saved threshold", () => {
    const result = mergeSettings({ cpuWarnPercent: -1 });
    expect(result.cpuWarnPercent).toBe(DEFAULT_SETTINGS.cpuWarnPercent);
  });
});

describe("sysmonStore persistence", () => {
  it("writes through storage when updated before any panel renders", () => {
    const set = vi.fn();
    const storage: ExtensionStorage = {
      get: () => undefined,
      set,
      keys: () => [],
      subscribe: () => ({ dispose: () => {} }),
    };

    // Hydrated from activate() — no panel ever mounted.
    sysmonStore.hydrate(storage);

    const next: Settings = mergeSettings({
      panels: [{ id: "cpu", enabled: false }],
    });
    sysmonStore.updateSettings(next);

    expect(set).toHaveBeenCalledWith("settings", next);
  });

  it("re-reads settings when storage notifies after activate (hydration race)", () => {
    let saved: Settings | undefined;
    let notify: () => void = () => {};
    const storage = {
      get: (key: string, fallback?: unknown) =>
        key === "settings" ? (saved ?? fallback) : fallback,
      set: (key: string, value: unknown) => {
        if (key === "settings") saved = value as Settings;
      },
      keys: () => (saved ? ["settings"] : []),
      subscribe: (listener: () => void) => {
        notify = listener;
        return { dispose: () => {} };
      },
    } as ExtensionStorage;

    // activate() runs before app state has hydrated from disk → nothing saved.
    sysmonStore.hydrate(storage);

    // Persisted settings land later and the store notifies.
    saved = mergeSettings({ panels: [{ id: "cpu", enabled: false }] });
    notify();

    expect(
      sysmonStore.settings.panels.find((p) => p.id === "cpu")?.enabled,
    ).toBe(false);
  });
});
