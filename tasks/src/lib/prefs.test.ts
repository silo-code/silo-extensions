import { describe, expect, it } from "vitest";
import { createFakeStorage } from "../test/fakes";
import { createPrefsStore, readTaskPrefs } from "./prefs";
import { DEFAULT_VIEW_PREFS } from "./view";

describe("readTaskPrefs", () => {
  it("defaults to group-by-source and a done-excluded lane filter", () => {
    const prefs = readTaskPrefs(createFakeStorage(), null);
    expect(prefs.view.groupBy).toBe("source");
    expect(prefs.view.laneFilter).toEqual(DEFAULT_VIEW_PREFS.laneFilter);
  });

  it("keys view prefs per workspace", () => {
    const storage = createFakeStorage();
    storage.set("view:w1", { ...DEFAULT_VIEW_PREFS, groupBy: "status" });
    storage.set("view:w2", { ...DEFAULT_VIEW_PREFS, groupBy: "label" });
    expect(readTaskPrefs(storage, "w1").view.groupBy).toBe("status");
    expect(readTaskPrefs(storage, "w2").view.groupBy).toBe("label");
    expect(readTaskPrefs(storage, null).view.groupBy).toBe("source");
  });

  it("keeps only the true entries of a stored collapsedGroups map", () => {
    const storage = createFakeStorage();
    storage.set("view:w1", {
      collapsedGroups: { done: true, todo: false, junk: "x" },
    });
    expect(readTaskPrefs(storage, "w1").view.collapsedGroups).toEqual({
      done: true,
    });
    expect(readTaskPrefs(storage, "w2").view.collapsedGroups).toEqual({});
  });

  it("keeps an empty stored laneFilter but replaces a missing one", () => {
    const storage = createFakeStorage();
    storage.set("view:w1", { ...DEFAULT_VIEW_PREFS, laneFilter: [] });
    expect(readTaskPrefs(storage, "w1").view.laneFilter).toEqual([]);
    storage.set("view:w2", { groupBy: "none" });
    expect(readTaskPrefs(storage, "w2").view.laneFilter).toEqual(
      DEFAULT_VIEW_PREFS.laneFilter,
    );
  });
});

describe("createPrefsStore", () => {
  it("ignores writes before hydration and re-reads when it flips", () => {
    const storage = createFakeStorage();
    const store = createPrefsStore(storage);

    store.setView({ ...DEFAULT_VIEW_PREFS, groupBy: "status" });
    expect(storage.get("view:global")).toBeUndefined(); // not written pre-hydration

    // A value restored from disk arrives; hydration fires.
    storage.set("view:global", { ...DEFAULT_VIEW_PREFS, groupBy: "label" });
    expect(store.getState().view.groupBy).toBe("label");

    store.setHydrated(true);
    store.setView({ ...store.getState().view, groupBy: "none" });
    expect((storage.get("view:global") as { groupBy: string }).groupBy).toBe(
      "none",
    );
  });

  it("round-trips per-workspace prefs across a switch", () => {
    const storage = createFakeStorage();
    const store = createPrefsStore(storage);
    store.setHydrated(true);

    store.setWorkspace("w1");
    store.setView({ ...store.getState().view, sortBy: "title" });

    store.setWorkspace("w2");
    expect(store.getState().view.sortBy).toBe("rank");

    store.setWorkspace("w1");
    expect(store.getState().view.sortBy).toBe("title");
  });

  it("notifies subscribers on a real change only", () => {
    const storage = createFakeStorage();
    const store = createPrefsStore(storage);
    store.setHydrated(true);
    let hits = 0;
    store.subscribe(() => (hits += 1));
    store.setView({ ...store.getState().view, groupBy: "none" });
    expect(hits).toBe(1);
    store.setWorkspace(null); // no change (already null)
    expect(hits).toBe(1);
  });
});
