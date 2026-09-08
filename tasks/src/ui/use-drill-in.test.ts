import { describe, expect, it } from "vitest";
import { drillReducer, type DrillState } from "./use-drill-in";

describe("drillReducer", () => {
  it("opens a detail page from the list", () => {
    expect(drillReducer(null, { type: "open", sourceId: "s1", taskId: "t1" })).toEqual(
      { sourceId: "s1", taskId: "t1" },
    );
  });

  it("replaces the open page rather than nesting", () => {
    const open: DrillState = { sourceId: "s1", taskId: "t1" };
    expect(drillReducer(open, { type: "open", sourceId: "s2", taskId: "t2" })).toEqual(
      { sourceId: "s2", taskId: "t2" },
    );
  });

  it("pops one page back to the list", () => {
    const open: DrillState = { sourceId: "s1", taskId: "t1" };
    expect(drillReducer(open, { type: "back" })).toBeNull();
  });

  it("popping from the list page is a no-op — it never means 'close'", () => {
    expect(drillReducer(null, { type: "back" })).toBeNull();
    // Repeated pops stay on the list; nothing below it to fall through to.
    let state: DrillState = null;
    for (let i = 0; i < 3; i++) state = drillReducer(state, { type: "back" });
    expect(state).toBeNull();
  });

  it("a task from another source is reached in one step, not two", () => {
    const open: DrillState = { sourceId: "s1", taskId: "t1" };
    const next = drillReducer(open, {
      type: "open",
      sourceId: "s9",
      taskId: "t9",
    });
    expect(drillReducer(next, { type: "back" })).toBeNull();
  });
});
