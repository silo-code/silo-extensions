import { describe, expect, it } from "vitest";
import { truncatePreview } from "./text";

describe("truncatePreview", () => {
  it("returns undefined for empty, whitespace-only, or missing input", () => {
    expect(truncatePreview(undefined)).toBeUndefined();
    expect(truncatePreview("")).toBeUndefined();
    expect(truncatePreview("   \n\t  ")).toBeUndefined();
  });

  it("returns short text unchanged", () => {
    expect(truncatePreview("Fix the login bug")).toBe("Fix the login bug");
  });

  it("collapses internal whitespace and newlines to single spaces", () => {
    expect(truncatePreview("line one\n\nline   two\ttabbed")).toBe(
      "line one line two tabbed",
    );
  });

  it("trims leading/trailing whitespace", () => {
    expect(truncatePreview("  padded text  ")).toBe("padded text");
  });

  it("truncates long text at a word boundary and appends an ellipsis", () => {
    const text =
      "Clicking the toolbar button to open the Tasks sheet while it is already open sends the overlay into a stuck state that stops responding to any input";
    const out = truncatePreview(text, 80);
    expect(out!.length).toBeLessThanOrEqual(81); // 80 + the ellipsis char
    expect(out!.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/\s…$/); // no dangling space before the ellipsis
    expect(text.startsWith(out!.slice(0, -1))).toBe(true);
  });

  it("hard-cuts a single word longer than max rather than returning it whole", () => {
    const longWord = "a".repeat(200);
    const out = truncatePreview(longWord, 50);
    expect(out).toBe("a".repeat(50) + "…");
  });

  it("respects a custom max length", () => {
    expect(truncatePreview("exactly ten", 11)).toBe("exactly ten");
    expect(truncatePreview("exactly tenn", 11)!.endsWith("…")).toBe(true);
  });
});
