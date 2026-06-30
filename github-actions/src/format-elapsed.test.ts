import { describe, it, expect } from "vitest";
import { formatElapsed } from "./format-elapsed";

// Fixed reference instant so the relative output is deterministic.
const NOW = new Date("2026-01-01T00:00:00Z").getTime();
const ago = (ms: number) => new Date(NOW - ms);

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("formatElapsed", () => {
  it('returns "just now" under a minute', () => {
    expect(formatElapsed(ago(0), NOW)).toBe("just now");
    expect(formatElapsed(ago(59 * SEC), NOW)).toBe("just now");
  });

  it("reports minutes between 1m and 59m", () => {
    expect(formatElapsed(ago(MIN), NOW)).toBe("1m ago");
    expect(formatElapsed(ago(59 * MIN), NOW)).toBe("59m ago");
  });

  it("reports hours between 1h and 23h", () => {
    expect(formatElapsed(ago(HOUR), NOW)).toBe("1h ago");
    expect(formatElapsed(ago(23 * HOUR), NOW)).toBe("23h ago");
  });

  it("reports days at and beyond 24h", () => {
    expect(formatElapsed(ago(DAY), NOW)).toBe("1d ago");
    expect(formatElapsed(ago(3 * DAY), NOW)).toBe("3d ago");
  });
});
