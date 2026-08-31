import { describe, expect, it } from "vitest";
import { labelChipStyle, parseLabels } from "./labels";

describe("parseLabels", () => {
  it("trims, drops blanks, de-duplicates, keeps first-seen order", () => {
    expect(parseLabels("  backend , , frontend ,backend")).toEqual([
      "backend",
      "frontend",
    ]);
  });

  it("returns [] for an empty or whitespace-only string", () => {
    expect(parseLabels("")).toEqual([]);
    expect(parseLabels("  ,  ")).toEqual([]);
  });
});

describe("labelChipStyle", () => {
  it("is deterministic per label", () => {
    expect(labelChipStyle("backend")).toEqual(labelChipStyle("backend"));
  });

  it("varies the background across labels", () => {
    const backgrounds = new Set(
      ["backend", "frontend", "bug", "chore", "docs"].map(
        (l) => labelChipStyle(l).background,
      ),
    );
    expect(backgrounds.size).toBeGreaterThan(1);
  });

  it("always returns a valid hsl background and a contrast text color", () => {
    for (const l of ["a", "backend", "🔥", "a-very-long-label-name", ""]) {
      const { background, color } = labelChipStyle(l);
      const m = background.match(/^hsl\((\d+) 65% 45%\)$/);
      expect(m).not.toBeNull();
      expect(Number(m![1])).toBeGreaterThanOrEqual(0);
      expect(Number(m![1])).toBeLessThan(360);
      expect(["#161616", "#ffffff"]).toContain(color);
    }
  });

  it("can pick either text color depending on the label's hue", () => {
    const colors = new Set<string>();
    for (let i = 0; i < 500; i++) {
      colors.add(labelChipStyle(`label-${i}`).color);
    }
    expect(colors).toEqual(new Set(["#161616", "#ffffff"]));
  });
});
