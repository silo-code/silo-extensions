import { describe, it, expect } from "vitest";
import { getIconVariant, getLabel, getTooltip } from "./status-labels";
import type { StatusBarState } from "./store";

describe("getLabel", () => {
  it("labels each non-ok state", () => {
    expect(getLabel({ kind: "gh-missing" })).toBe("Actions: cli missing");
    expect(getLabel({ kind: "unauthenticated" })).toBe("Actions: Auth failed");
    expect(getLabel({ kind: "api-error", message: "boom" })).toBe("Actions: Error");
    expect(getLabel({ kind: "no-repo" })).toBe("Actions: No git repository");
    expect(getLabel({ kind: "checking" })).toBe("Actions: Checking...");
  });

  it("labels the ok state across failed/running combinations", () => {
    expect(getLabel({ kind: "ok", failed: 0, running: 0 })).toBe("Actions: ok");
    expect(getLabel({ kind: "ok", failed: 2, running: 0 })).toBe("Actions: 2 failed");
    expect(getLabel({ kind: "ok", failed: 0, running: 3 })).toBe("Actions: 3 running");
    expect(getLabel({ kind: "ok", failed: 1, running: 4 })).toBe("Actions: 1 failed · 4 running");
  });
});

describe("getTooltip", () => {
  it("interpolates the api-error message", () => {
    expect(getTooltip({ kind: "api-error", message: "rate limited" })).toBe("GitHub Actions: rate limited");
  });

  it('says "all clear" when ok with nothing failed or running', () => {
    expect(getTooltip({ kind: "ok", failed: 0, running: 0 })).toBe("GitHub Actions: all clear");
  });

  it("joins failed and running counts", () => {
    expect(getTooltip({ kind: "ok", failed: 1, running: 2 })).toBe("GitHub Actions: 1 failed, 2 running");
  });
});

describe("getIconVariant", () => {
  it('is "failed" for error states and ok-with-failures', () => {
    const failed: StatusBarState[] = [
      { kind: "gh-missing" },
      { kind: "unauthenticated" },
      { kind: "api-error", message: "x" },
      { kind: "ok", failed: 1, running: 0 },
    ];
    for (const s of failed) expect(getIconVariant(s)).toBe("failed");
  });

  it('is "dim" for benign states', () => {
    const dim: StatusBarState[] = [
      { kind: "no-repo" },
      { kind: "checking" },
      { kind: "ok", failed: 0, running: 5 },
    ];
    for (const s of dim) expect(getIconVariant(s)).toBe("dim");
  });
});
