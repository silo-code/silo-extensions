import { describe, expect, it } from "vitest";
import { formatElapsed } from "./time";

const NOW = 1_700_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("formatElapsed", () => {
  it("is null for the unknown-time sentinel, so the age is dropped entirely", () => {
    // `0` means "migrated from the 0.2.x boolean form" — not "the epoch".
    expect(formatElapsed(0, NOW)).toBeNull();
  });

  it("reads 'just now' under a minute, and for clock skew", () => {
    expect(formatElapsed(NOW, NOW)).toBe("just now");
    expect(formatElapsed(NOW - 59_000, NOW)).toBe("just now");
    expect(formatElapsed(NOW + 5_000, NOW)).toBe("just now");
  });

  it("uses the host's compact m / h / d vocabulary", () => {
    expect(formatElapsed(NOW - MIN, NOW)).toBe("1m");
    expect(formatElapsed(NOW - 59 * MIN, NOW)).toBe("59m");
    expect(formatElapsed(NOW - HOUR, NOW)).toBe("1h");
    expect(formatElapsed(NOW - 6 * HOUR, NOW)).toBe("6h");
    expect(formatElapsed(NOW - 23 * HOUR, NOW)).toBe("23h");
    expect(formatElapsed(NOW - DAY, NOW)).toBe("1d");
    expect(formatElapsed(NOW - 9 * DAY, NOW)).toBe("9d");
  });

  it("keeps counting in days rather than rolling over to weeks", () => {
    // The host's own vocabulary stops at days; a "5w" here would read as a
    // unit nothing else in the app uses.
    expect(formatElapsed(NOW - 400 * DAY, NOW)).toBe("400d");
  });
});
