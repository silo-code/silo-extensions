import { describe, expect, it } from "vitest";
import { generateTaskId, nextRank } from "./ids";

describe("generateTaskId", () => {
  it("produces distinct ids across a large batch", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5000; i++) ids.add(generateTaskId());
    expect(ids.size).toBe(5000);
  });
});

describe("nextRank", () => {
  it("starts at 1 for an empty file, zero-padded", () => {
    expect(nextRank([])).toBe("000000000001");
  });

  it("appends after the current maximum", () => {
    expect(nextRank(["000000000001", "000000000004", "000000000002"])).toBe(
      "000000000005",
    );
  });

  it("ranks sort lexicographically in creation order", () => {
    let ranks: string[] = [];
    for (let i = 0; i < 20; i++) ranks = [...ranks, nextRank(ranks)];
    expect([...ranks].sort()).toEqual(ranks);
  });

  it("ignores a non-numeric rank left by a hand edit", () => {
    expect(nextRank(["oops", "000000000003"])).toBe("000000000004");
  });
});
