import { describe, it, expect } from "vitest";
import {
  severityFor,
  severityColor,
  SEVERITY_COLORS,
} from "./severity";

describe("severityFor", () => {
  it("is normal below the warning threshold", () => {
    expect(severityFor(0)).toBe("normal");
    expect(severityFor(74)).toBe("normal");
  });

  it("is warning from 75 up to (but not including) 90", () => {
    expect(severityFor(75)).toBe("warning");
    expect(severityFor(89)).toBe("warning");
  });

  it("is critical from 90 up", () => {
    expect(severityFor(90)).toBe("critical");
    expect(severityFor(100)).toBe("critical");
    expect(severityFor(120)).toBe("critical"); // multi-core CPU sums clamp elsewhere
  });
});

describe("severityColor", () => {
  it("returns null when normal (inherit chrome color)", () => {
    expect(severityColor(50)).toBeNull();
  });

  it("returns the warning/critical hue otherwise", () => {
    expect(severityColor(80)).toBe(SEVERITY_COLORS.warning);
    expect(severityColor(95)).toBe(SEVERITY_COLORS.critical);
  });
});
