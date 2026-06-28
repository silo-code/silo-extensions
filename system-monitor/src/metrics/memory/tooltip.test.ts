import { describe, it, expect } from "vitest";
import { segmentTooltip } from "./tooltip";
import type { MemData } from "../../store";

const GiB = 1024 ** 3;

describe("segmentTooltip", () => {
  it("lists whatever segments the collector reported, in order", () => {
    const data: MemData = {
      totalBytes: 16 * GiB,
      usedBytes: 8 * GiB,
      segments: [
        { label: "Used", bytes: 8 * GiB, color: "#000" },
        { label: "Cache", bytes: 4 * GiB, color: "#000" },
        { label: "Free", bytes: 4 * GiB, color: "#000" },
      ],
    };
    expect(segmentTooltip(data)).toBe(
      "Used 8.0 GB  ·  Cache 4.0 GB  ·  Free 4.0 GB",
    );
  });
});
