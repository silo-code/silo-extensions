import { describe, it, expect } from "vitest";
import { ROOT_STACK, pushView, popView, currentView, serializeStack, restoreStack } from "./view-stack";
import type { ViewStack } from "./view-stack";

describe("pushView / popView / currentView", () => {
  it("starts at the list root", () => {
    expect(currentView(ROOT_STACK)).toEqual({ kind: "list" });
  });

  it("pushes a detail view on top", () => {
    const stack = pushView(ROOT_STACK, { kind: "detail", folder: "/repo", number: 42 });
    expect(currentView(stack)).toEqual({ kind: "detail", folder: "/repo", number: 42 });
  });

  it("pops back to the previous view", () => {
    const stack = pushView(ROOT_STACK, { kind: "detail", folder: "/repo", number: 42 });
    expect(currentView(popView(stack))).toEqual({ kind: "list" });
  });

  it("popping at the root is a no-op", () => {
    const popped = popView(ROOT_STACK);
    expect(popped).toBe(ROOT_STACK);
    expect(currentView(popped)).toEqual({ kind: "list" });
  });

  it("supports multiple pushes", () => {
    let stack: ViewStack = ROOT_STACK;
    stack = pushView(stack, { kind: "detail", folder: "/a", number: 1 });
    stack = pushView(stack, { kind: "detail", folder: "/b", number: 2 });
    expect(currentView(stack)).toEqual({ kind: "detail", folder: "/b", number: 2 });
    stack = popView(stack);
    expect(currentView(stack)).toEqual({ kind: "detail", folder: "/a", number: 1 });
  });
});

describe("serializeStack / restoreStack round-trip", () => {
  it("round-trips a multi-level stack", () => {
    const stack = pushView(pushView(ROOT_STACK, { kind: "detail", folder: "/a", number: 1 }), {
      kind: "detail",
      folder: "/b",
      number: 2,
    });
    const restored = restoreStack(serializeStack(stack));
    expect(restored).toEqual(stack);
  });

  it("round-trips the root stack", () => {
    expect(restoreStack(serializeStack(ROOT_STACK))).toEqual(ROOT_STACK);
  });
});

describe("restoreStack garbage handling", () => {
  it("falls back to root for null/undefined", () => {
    expect(restoreStack(null)).toBe(ROOT_STACK);
    expect(restoreStack(undefined)).toBe(ROOT_STACK);
  });

  it("falls back to root for a non-array", () => {
    expect(restoreStack({ kind: "list" })).toBe(ROOT_STACK);
    expect(restoreStack("garbage")).toBe(ROOT_STACK);
  });

  it("falls back to root for an empty array", () => {
    expect(restoreStack([])).toBe(ROOT_STACK);
  });

  it("falls back to root when the first entry isn't a list view", () => {
    expect(restoreStack([{ kind: "detail", folder: "/a", number: 1 }])).toBe(ROOT_STACK);
  });

  it("falls back to root when an entry is malformed", () => {
    expect(restoreStack([{ kind: "list" }, { kind: "detail", folder: "/a" }])).toBe(ROOT_STACK);
    expect(restoreStack([{ kind: "list" }, { kind: "mystery" }])).toBe(ROOT_STACK);
  });
});
