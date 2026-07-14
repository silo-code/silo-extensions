import { describe, it, expect } from "vitest";
import { neededMetrics, wants } from "./poll";
import type { PanelId, Settings } from "./store";

const allEnabled: Settings = {
  panels: [
    { id: "cpu", enabled: true },
    { id: "memory", enabled: true },
  ],
  statusBar: [
    { id: "cpu", enabled: true },
    { id: "memory", enabled: true },
  ],
  workspaceStatus: true,
};

describe("neededMetrics", () => {
  it("includes all ids when everything is enabled", () => {
    const needed = neededMetrics(allEnabled);
    expect(needed.has("cpu")).toBe(true);
    expect(needed.has("memory")).toBe(true);
  });

  it("includes a metric when enabled only in the panel", () => {
    const s: Settings = {
      panels: [{ id: "cpu", enabled: true }],
      statusBar: [{ id: "cpu", enabled: false }],
      workspaceStatus: true,
    };
    expect(neededMetrics(s).has("cpu")).toBe(true);
  });

  it("includes a metric when enabled only in the status bar", () => {
    const s: Settings = {
      panels: [{ id: "cpu", enabled: false }],
      statusBar: [{ id: "cpu", enabled: true }],
      workspaceStatus: true,
    };
    expect(neededMetrics(s).has("cpu")).toBe(true);
  });

  it("excludes a metric when disabled in both panel and status bar", () => {
    const s: Settings = {
      panels: [
        { id: "cpu", enabled: false },
        { id: "memory", enabled: true },
      ],
      statusBar: [
        { id: "cpu", enabled: false },
        { id: "memory", enabled: false },
      ],
      workspaceStatus: true,
    };
    const needed = neededMetrics(s);
    expect(needed.has("cpu")).toBe(false);
    expect(needed.has("memory")).toBe(true);
  });

  it("returns empty set when all items are disabled", () => {
    const s: Settings = {
      panels: [
        { id: "cpu", enabled: false },
        { id: "memory", enabled: false },
      ],
      statusBar: [
        { id: "cpu", enabled: false },
        { id: "memory", enabled: false },
      ],
      workspaceStatus: true,
    };
    expect(neededMetrics(s).size).toBe(0);
  });

  it("returns empty set for empty settings", () => {
    const s: Settings = { panels: [], statusBar: [], workspaceStatus: true };
    expect(neededMetrics(s).size).toBe(0);
  });
});

describe("wants", () => {
  const set = (...ids: PanelId[]) => new Set<PanelId>(ids);

  it("matches the base id", () => {
    expect(wants(set("cpu"), "cpu")).toBe(true);
    expect(wants(set("memory"), "memory")).toBe(true);
  });

  it("matches rendering variants by prefix (cpu-bar → cpu)", () => {
    expect(wants(set("cpu-bar"), "cpu")).toBe(true);
    expect(wants(set("cpu-compact"), "cpu")).toBe(true);
    expect(wants(set("memory-pie"), "memory")).toBe(true);
  });

  it("does not cross metrics", () => {
    expect(wants(set("memory-pie"), "cpu")).toBe(false);
    expect(wants(set("cpu-bar"), "memory")).toBe(false);
    expect(wants(new Set<PanelId>(), "cpu")).toBe(false);
  });
});
