import { describe, expect, it } from "vitest";
import {
  ALL_LANES,
  ALL_PRIORITIES,
  LANE_LABELS,
  PRIORITY_LABELS,
} from "./task";

/**
 * The detail-page Lane / Priority `SegmentedTabs` map over `ALL_LANES` /
 * `ALL_PRIORITIES` and read `LANE_LABELS[lane]` / `PRIORITY_LABELS[priority]`
 * for each segment's label. A member with no label entry (or a stray label
 * key) renders a blank / phantom segment, so the array and its label map must
 * stay in lockstep.
 */
describe("lane / priority label maps", () => {
  it("every lane has exactly one non-empty label", () => {
    expect(Object.keys(LANE_LABELS).sort()).toEqual([...ALL_LANES].sort());
    for (const lane of ALL_LANES) expect(LANE_LABELS[lane]).toBeTruthy();
  });

  it("every priority has exactly one non-empty label", () => {
    expect(Object.keys(PRIORITY_LABELS).sort()).toEqual(
      [...ALL_PRIORITIES].sort(),
    );
    for (const p of ALL_PRIORITIES) expect(PRIORITY_LABELS[p]).toBeTruthy();
  });

  it("lists each member once", () => {
    expect(new Set(ALL_LANES).size).toBe(ALL_LANES.length);
    expect(new Set(ALL_PRIORITIES).size).toBe(ALL_PRIORITIES.length);
  });
});
