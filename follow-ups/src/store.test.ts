import { describe, expect, it } from "vitest";
import {
  clear,
  countMarks,
  isMarked,
  mark,
  parseMarks,
  pruneWorkspace,
  serializeMarks,
  statusLabel,
  toggle,
  type MarksState,
} from "./store";

function fresh(): MarksState {
  return new Map();
}

describe("mark / clear / toggle", () => {
  it("marks an editor and reports isMarked", () => {
    const state = fresh();
    expect(mark(state, "ws1", "editor", "e1")).toBe(true);
    expect(isMarked(state, "ws1", "editor", "e1")).toBe(true);
    expect(isMarked(state, "ws1", "terminal", "e1")).toBe(false);
    expect(mark(state, "ws1", "editor", "e1")).toBe(false);
  });

  it("clears a mark and drops empty workspaces", () => {
    const state = fresh();
    mark(state, "ws1", "terminal", "t1");
    expect(clear(state, "ws1", "terminal", "t1")).toBe(true);
    expect(state.has("ws1")).toBe(false);
    expect(clear(state, "ws1", "terminal", "t1")).toBe(false);
  });

  it("toggles on then off", () => {
    const state = fresh();
    expect(toggle(state, "ws1", "editor", "e1")).toBe(true);
    expect(isMarked(state, "ws1", "editor", "e1")).toBe(true);
    expect(toggle(state, "ws1", "editor", "e1")).toBe(true);
    expect(isMarked(state, "ws1", "editor", "e1")).toBe(false);
  });
});

describe("pruneWorkspace", () => {
  it("removes closed panels and keeps live ones", () => {
    const state = fresh();
    mark(state, "ws1", "editor", "e1");
    mark(state, "ws1", "editor", "e2");
    mark(state, "ws1", "terminal", "t1");
    const changed = pruneWorkspace(
      state,
      "ws1",
      new Set(["e1"]),
      new Set(),
    );
    expect(changed).toBe(true);
    expect(isMarked(state, "ws1", "editor", "e1")).toBe(true);
    expect(isMarked(state, "ws1", "editor", "e2")).toBe(false);
    expect(isMarked(state, "ws1", "terminal", "t1")).toBe(false);
  });

  it("is a no-op when all marked panels are still live", () => {
    const state = fresh();
    mark(state, "ws1", "editor", "e1");
    expect(
      pruneWorkspace(state, "ws1", new Set(["e1"]), new Set()),
    ).toBe(false);
  });
});

describe("countMarks / statusLabel", () => {
  it("counts editors and terminals, optionally filtered to live ids", () => {
    const state = fresh();
    mark(state, "ws1", "editor", "e1");
    mark(state, "ws1", "editor", "e2");
    mark(state, "ws1", "terminal", "t1");
    expect(countMarks(state, "ws1")).toBe(3);
    expect(countMarks(state, "ws1", new Set(["e1"]), new Set(["t1"]))).toBe(2);
    expect(countMarks(state, "missing")).toBe(0);
  });

  it("formats the workspace status label", () => {
    expect(statusLabel(1)).toBe("1 follow-up");
    expect(statusLabel(3)).toBe("3 follow-ups");
  });
});

describe("serialize / parse", () => {
  it("round-trips marks", () => {
    const state = fresh();
    mark(state, "ws1", "editor", "e2");
    mark(state, "ws1", "editor", "e1");
    mark(state, "ws1", "terminal", "t1");
    mark(state, "ws2", "terminal", "t9");
    const bag = serializeMarks(state);
    expect(bag.ws1.editors).toEqual(["e1", "e2"]);
    expect(bag.ws1.terminals).toEqual(["t1"]);
    expect(bag.ws2.terminals).toEqual(["t9"]);
    const restored = parseMarks(bag);
    expect(isMarked(restored, "ws1", "editor", "e1")).toBe(true);
    expect(isMarked(restored, "ws2", "terminal", "t9")).toBe(true);
    expect(serializeMarks(restored)).toEqual(bag);
  });

  it("tolerates garbage input", () => {
    expect(parseMarks(null).size).toBe(0);
    expect(parseMarks("nope").size).toBe(0);
    expect(parseMarks({ ws: { editors: [1, "e1"], terminals: null } }).size).toBe(
      1,
    );
    expect(isMarked(parseMarks({ ws: { editors: [1, "e1"] } }), "ws", "editor", "e1")).toBe(
      true,
    );
  });
});
