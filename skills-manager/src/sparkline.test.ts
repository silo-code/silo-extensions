import { describe, expect, it } from "vitest";
import { buildSparklinePoints } from "./sparkline";

describe("buildSparklinePoints", () => {
  it("maps values across the full width and height", () => {
    expect(buildSparklinePoints([1, 2, 3], 56, 16)).toBe(
      "0.0,10.3 28.0,5.7 56.0,1.0",
    );
  });

  it("draws a flat line for constant values", () => {
    expect(buildSparklinePoints([5, 5], 56, 16)).toBe("0.0,1.0 56.0,1.0");
  });

  it("respects a custom canvas size", () => {
    expect(buildSparklinePoints([0, 10], 10, 10)).toBe("0.0,9.0 10.0,1.0");
  });
});
