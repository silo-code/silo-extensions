import { describe, expect, it } from "vitest";
import { coerceLabels, defaultLabels, reorderLabels } from "./labels";
import { breakdownText, labelBreakdown } from "./summary";

describe("labelBreakdown", () => {
  it("keeps only labels with a live mark, in the user's label order", () => {
    const labels = defaultLabels();
    const entries = labelBreakdown(labels, { error: 1, warn: 2 });
    expect(entries.map((e) => [e.label.id, e.count])).toEqual([
      ["warn", 2],
      ["error", 1],
    ]);
  });

  it("follows a reordered label list rather than the shipped order", () => {
    const labels = coerceLabels(
      reorderLabels(defaultLabels(), 2, 0).map((l) => ({ id: l.id })),
    );
    expect(labels[0].id).toBe("error");
    const entries = labelBreakdown(labels, { warn: 1, error: 1 });
    expect(entries.map((e) => e.label.id)).toEqual(["error", "warn"]);
  });

  it("is empty for a workspace with no marks", () => {
    expect(labelBreakdown(defaultLabels(), {})).toEqual([]);
  });
});

describe("breakdownText", () => {
  it("reads as a count per label name", () => {
    const entries = labelBreakdown(defaultLabels(), { warn: 2, error: 1 });
    expect(breakdownText(entries)).toBe("2 Need more info · 1 Blocked");
  });

  it("uses renamed labels", () => {
    const labels = defaultLabels().map((l) =>
      l.id === "error" ? { ...l, name: "On hold" } : l,
    );
    expect(breakdownText(labelBreakdown(labels, { error: 3 }))).toBe(
      "3 On hold",
    );
  });
});
