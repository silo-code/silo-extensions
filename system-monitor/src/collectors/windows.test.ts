import { describe, it, expect } from "vitest";
import { parseWindowsCpu, parseWindowsMem } from "./windows";

const KB = 1024;

describe("parseWindowsCpu", () => {
  it("reads user then privileged CookedValues", () => {
    expect(parseWindowsCpu("12.5\n4.25")).toEqual({ user: 12.5, sys: 4.25 });
  });

  it("tolerates locale decimal commas and blank lines", () => {
    expect(parseWindowsCpu("\n12,5\n4,25\n")).toEqual({ user: 12.5, sys: 4.25 });
  });

  it("clamps to 0–100", () => {
    expect(parseWindowsCpu("150\n-5")).toEqual({ user: 100, sys: 0 });
  });

  it("returns null when fewer than two values", () => {
    expect(parseWindowsCpu("42")).toBeNull();
    expect(parseWindowsCpu("")).toBeNull();
  });
});

describe("parseWindowsMem", () => {
  it("converts total/free KB to a Used/Free split", () => {
    const r = parseWindowsMem("33554432\n8388608"); // 32 GiB total, 8 GiB free
    expect(r?.totalBytes).toBe(33554432 * KB);
    expect(r?.usedBytes).toBe((33554432 - 8388608) * KB);
    expect(r?.segments.map((s) => s.label)).toEqual(["Used", "Free"]);
    const sum = r!.segments.reduce((a, s) => a + s.bytes, 0);
    expect(sum).toBe(33554432 * KB);
  });

  it("returns null on missing or zero total", () => {
    expect(parseWindowsMem("8388608")).toBeNull();
    expect(parseWindowsMem("0\n100")).toBeNull();
  });
});
