import { describe, expect, it, vi } from "vitest";
import { createMarksStore } from "./marks-store";
import { setFollowUp, type MarksState } from "./store";

describe("createMarksStore", () => {
  it("hands the live map to the chrome binders without copying it", () => {
    const state: MarksState = new Map();
    const store = createMarksStore(state);
    expect(store.marks()).toBe(state);
  });

  it("changes snapshot identity on notify, so useServiceState re-renders", () => {
    // `store.ts` mutates the map in place — which is what the per-paint
    // binders want and exactly what `useSyncExternalStore` cannot see.
    const store = createMarksStore(new Map());
    const before = store.getState();
    setFollowUp(store.marks(), "ws1", "editor", "e1", { labelId: "warn" }, 1);
    expect(store.getState()).toBe(before);

    store.notify();
    expect(store.getState()).not.toBe(before);
    expect(store.getState().state).toBe(before.state);
  });

  it("notifies every subscriber, and stops once disposed", () => {
    const store = createMarksStore(new Map());
    const a = vi.fn();
    const b = vi.fn();
    const subA = store.subscribe(a);
    store.subscribe(b);
    store.notify();
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();

    subA.dispose();
    store.notify();
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledTimes(2);
  });

  it("swaps the whole map on replace and publishes it", () => {
    const store = createMarksStore(new Map());
    const seen = vi.fn();
    store.subscribe(seen);
    const next: MarksState = new Map();
    setFollowUp(next, "ws1", "editor", "e1", { labelId: "ok" }, 1);

    store.replace(next);
    expect(store.marks()).toBe(next);
    expect(seen).toHaveBeenCalledOnce();
    expect(store.getState().state).toBe(next);
  });
});
