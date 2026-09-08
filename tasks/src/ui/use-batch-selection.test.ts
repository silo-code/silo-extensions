import { describe, expect, it } from "vitest";
import { pickedReducer, type PickedIds } from "./use-batch-selection";

describe("pickedReducer", () => {
  it("picks an unpicked id", () => {
    const next = pickedReducer(new Set(), { type: "toggle", id: "t1" });
    expect([...next]).toEqual(["t1"]);
  });

  it("unpicks an already-picked id", () => {
    const state: PickedIds = new Set(["t1", "t2"]);
    const next = pickedReducer(state, { type: "toggle", id: "t1" });
    expect([...next]).toEqual(["t2"]);
  });

  it("toggleAll picks every visible id when any is unpicked", () => {
    const state: PickedIds = new Set(["t1"]);
    const next = pickedReducer(state, {
      type: "toggleAll",
      ids: ["t1", "t2", "t3"],
    });
    expect([...next].sort()).toEqual(["t1", "t2", "t3"]);
  });

  it("toggleAll clears every visible id only when all are already picked", () => {
    const state: PickedIds = new Set(["t1", "t2", "t3"]);
    const next = pickedReducer(state, {
      type: "toggleAll",
      ids: ["t1", "t2", "t3"],
    });
    expect(next.size).toBe(0);
  });

  it("toggleAll never touches a picked id outside the visible set", () => {
    const state: PickedIds = new Set(["t1", "outside"]);
    // t1 is visible and picked, t2/t3 are visible and not — not "all picked",
    // so this picks the rest rather than clearing.
    const next = pickedReducer(state, {
      type: "toggleAll",
      ids: ["t1", "t2", "t3"],
    });
    expect([...next].sort()).toEqual(["outside", "t1", "t2", "t3"]);
  });

  it("toggleAll with an empty visible set is a no-op", () => {
    const state: PickedIds = new Set(["t1"]);
    const next = pickedReducer(state, { type: "toggleAll", ids: [] });
    expect([...next]).toEqual(["t1"]);
  });

  it("clear empties the selection", () => {
    const state: PickedIds = new Set(["t1", "t2"]);
    expect(pickedReducer(state, { type: "clear" }).size).toBe(0);
  });

  it("clear on an already-empty selection returns the same identity", () => {
    const state: PickedIds = new Set();
    expect(pickedReducer(state, { type: "clear" })).toBe(state);
  });
});
