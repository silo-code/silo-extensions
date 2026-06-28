import { describe, it, expect } from "vitest";
import { pushCpuSample, formatBytes, MAX_SAMPLES } from "./metrics";

// ── pushCpuSample ─────────────────────────────────────────────────────────────

describe("pushCpuSample", () => {
  it("appends a sample", () => {
    const h = pushCpuSample([{ user: 10, sys: 5 }], 20, 8);
    expect(h).toHaveLength(2);
    expect(h[1]).toEqual({ user: 20, sys: 8 });
  });

  it("drops the oldest when at MAX_SAMPLES", () => {
    const full = Array.from({ length: MAX_SAMPLES }, (_, i) => ({
      user: i,
      sys: 0,
    }));
    const next = pushCpuSample(full, 999, 1);
    expect(next).toHaveLength(MAX_SAMPLES);
    expect(next[0].user).toBe(1);
    expect(next[next.length - 1]).toEqual({ user: 999, sys: 1 });
  });

  it("does not mutate the input array", () => {
    const orig = [{ user: 1, sys: 1 }];
    pushCpuSample(orig, 2, 2);
    expect(orig).toHaveLength(1);
  });
});

// ── formatBytes ───────────────────────────────────────────────────────────────

describe("formatBytes", () => {
  it("formats GB values", () => {
    expect(formatBytes(16 * 1024 ** 3)).toBe("16.0 GB");
    expect(formatBytes(1.5 * 1024 ** 3)).toBe("1.5 GB");
  });

  it("formats MB values", () => {
    expect(formatBytes(512 * 1024 ** 2)).toBe("512 MB");
    expect(formatBytes(648 * 1024 ** 2)).toBe("648 MB");
  });
});
