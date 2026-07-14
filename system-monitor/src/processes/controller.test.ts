import { describe, it, expect } from "vitest";
import { shouldRunProcesses } from "./controller";
import type { Settings } from "../store";

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    panels: [{ id: "processes", enabled: true }],
    statusBar: [],
    workspaceStatus: true,
    ...overrides,
  };
}

describe("shouldRunProcesses", () => {
  it("runs when the panel is active and the processes panel is enabled", () => {
    expect(
      shouldRunProcesses(settings({ workspaceStatus: false }), true),
    ).toBe(true);
  });

  it("does not run when the panel is active but the processes panel is disabled", () => {
    const s = settings({
      panels: [{ id: "processes", enabled: false }],
      workspaceStatus: false,
    });
    expect(shouldRunProcesses(s, true)).toBe(false);
  });

  it("does not run when the processes panel is enabled but the panel isn't active", () => {
    expect(
      shouldRunProcesses(settings({ workspaceStatus: false }), false),
    ).toBe(false);
  });

  // Regression: badges/status rows for background workspaces must not depend
  // on the System Monitor side panel being open anywhere — that's the whole
  // point of an ambient cross-workspace monitor.
  it("runs when workspaceStatus is on, even with the panel inactive and the processes panel disabled", () => {
    const s = settings({
      panels: [{ id: "processes", enabled: false }],
      workspaceStatus: true,
    });
    expect(shouldRunProcesses(s, false)).toBe(true);
  });

  it("does not run when neither the panel nor workspaceStatus wants it", () => {
    const s = settings({
      panels: [{ id: "processes", enabled: false }],
      workspaceStatus: false,
    });
    expect(shouldRunProcesses(s, false)).toBe(false);
  });
});
