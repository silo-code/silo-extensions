import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "./time";

const NOW = 1_700_000_000_000;

describe("formatRelativeTime", () => {
  it("reads as \"just now\" for anything under a minute, including future/skewed clocks", () => {
    expect(formatRelativeTime(NOW, NOW)).toBe("just now");
    expect(formatRelativeTime(NOW - 30_000, NOW)).toBe("just now");
    expect(formatRelativeTime(NOW + 5_000, NOW)).toBe("just now");
  });

  it("minutes", () => {
    expect(formatRelativeTime(NOW - 60_000, NOW)).toBe("1m ago");
    expect(formatRelativeTime(NOW - 45 * 60_000, NOW)).toBe("45m ago");
  });

  it("hours", () => {
    expect(formatRelativeTime(NOW - 60 * 60_000, NOW)).toBe("1h ago");
    expect(formatRelativeTime(NOW - 23 * 60 * 60_000, NOW)).toBe("23h ago");
  });

  it("days", () => {
    expect(formatRelativeTime(NOW - 24 * 60 * 60_000, NOW)).toBe("1d ago");
    expect(formatRelativeTime(NOW - 6 * 24 * 60 * 60_000, NOW)).toBe("6d ago");
  });

  it("weeks", () => {
    expect(formatRelativeTime(NOW - 7 * 24 * 60 * 60_000, NOW)).toBe("1w ago");
    expect(formatRelativeTime(NOW - 29 * 24 * 60 * 60_000, NOW)).toBe("4w ago");
  });

  it("months", () => {
    expect(formatRelativeTime(NOW - 30 * 24 * 60 * 60_000, NOW)).toBe("1mo ago");
    expect(formatRelativeTime(NOW - 364 * 24 * 60 * 60_000, NOW)).toBe(
      "12mo ago",
    );
  });

  it("years", () => {
    expect(formatRelativeTime(NOW - 365 * 24 * 60 * 60_000, NOW)).toBe("1y ago");
    expect(formatRelativeTime(NOW - 800 * 24 * 60 * 60_000, NOW)).toBe("2y ago");
  });

  it("defaults `now` to the real clock when omitted", () => {
    expect(formatRelativeTime(Date.now() - 1000)).toBe("just now");
  });
});
