import { describe, expect, it } from "vitest";
import { createFakeStorage } from "../test/fakes";
import {
  createPrefsStore,
  CROSS_SCOPE,
  SHEET_SCOPE,
  readTaskPrefs,
} from "./prefs";
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

  it("R12: sortDir defaults to asc and only \"desc\" survives coercion", () => {
    const storage = createFakeStorage();
    storage.set("view:w1", { sortDir: "desc" });
    expect(readTaskPrefs(storage, "w1").view.sortDir).toBe("desc");
    storage.set("view:w2", { sortDir: "sideways" });
    expect(readTaskPrefs(storage, "w2").view.sortDir).toBe("asc");
    storage.set("view:w3", {});
    expect(readTaskPrefs(storage, "w3").view.sortDir).toBe("asc");
  });

  it("R15: an unrecognized sortBy (e.g. a stale persisted \"id\" from before R15 removed it) falls back to the default", () => {
    const storage = createFakeStorage();
    storage.set("view:w1", { ...DEFAULT_VIEW_PREFS, sortBy: "id" });
    expect(readTaskPrefs(storage, "w1").view.sortBy).toBe(
      DEFAULT_VIEW_PREFS.sortBy,
    );
  });

  it("R12: keeps an empty stored sourceFilter but replaces a missing one, same rule as labelFilter", () => {
    const storage = createFakeStorage();
    storage.set("view:w1", { ...DEFAULT_VIEW_PREFS, sourceFilter: [] });
    expect(readTaskPrefs(storage, "w1").view.sourceFilter).toEqual([]);
    storage.set("view:w2", { groupBy: "none" });
    expect(readTaskPrefs(storage, "w2").view.sourceFilter).toEqual([]);
  });

  it("R12: drops non-string entries from a stored sourceFilter", () => {
    const storage = createFakeStorage();
    storage.set("view:w1", { sourceFilter: ["s1", 2, null, "s3"] });
    expect(readTaskPrefs(storage, "w1").view.sourceFilter).toEqual(["s1", "s3"]);
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

  it("R12: sortDir and sourceFilter count as real changes too — a second store on the same key sees them via the storage subscription", () => {
    const storage = createFakeStorage();
    const a = createPrefsStore(storage);
    const b = createPrefsStore(storage);
    a.setHydrated(true);
    b.setHydrated(true);

    a.setView({ ...a.getState().view, sortDir: "desc" });
    expect(b.getState().view.sortDir).toBe("desc");

    a.setView({ ...a.getState().view, sourceFilter: ["s1"] });
    expect(b.getState().view.sourceFilter).toEqual(["s1"]);
  });
});

describe("the aggregated (cross-workspace) scope", () => {
  it("round-trips under its own key", () => {
    const storage = createFakeStorage();
    const store = createPrefsStore(storage, CROSS_SCOPE);
    store.setHydrated(true);
    store.setView({ ...store.getState().view, groupBy: "status" });
    expect((storage.get("view:cross") as { groupBy: string }).groupBy).toBe(
      "status",
    );
    expect(readTaskPrefs(storage, CROSS_SCOPE).view.groupBy).toBe("status");
  });

  it("never reads or writes a workspace key", () => {
    const storage = createFakeStorage();
    storage.set("view:w1", { ...DEFAULT_VIEW_PREFS, groupBy: "label" });
    storage.set("view:global", { ...DEFAULT_VIEW_PREFS, groupBy: "none" });

    const cross = createPrefsStore(storage, CROSS_SCOPE);
    cross.setHydrated(true);
    expect(cross.getState().view.groupBy).toBe("source"); // its own default

    cross.setView({ ...cross.getState().view, sortBy: "title" });
    expect((storage.get("view:w1") as { groupBy: string }).groupBy).toBe("label");
    expect((storage.get("view:global") as { groupBy: string }).groupBy).toBe(
      "none",
    );
    expect(storage.keys()).toContain("view:cross");
  });

  it("ignores setWorkspace — the aggregated surfaces are not per-workspace", () => {
    const storage = createFakeStorage();
    storage.set("view:cross", { ...DEFAULT_VIEW_PREFS, sortBy: "title" });
    const cross = createPrefsStore(storage, CROSS_SCOPE);
    cross.setHydrated(true);
    cross.setWorkspace("w1");
    expect(cross.getState().view.sortBy).toBe("title");
    cross.setView({ ...cross.getState().view, sortBy: "priority" });
    expect(storage.get("view:w1")).toBeUndefined();
  });

  it("keeps the Navigator view and the sheet on separate keys", () => {
    const storage = createFakeStorage();
    const navigator = createPrefsStore(storage, CROSS_SCOPE);
    const sheet = createPrefsStore(storage, SHEET_SCOPE);
    navigator.setHydrated(true);
    sheet.setHydrated(true);

    navigator.setView({ ...navigator.getState().view, sortBy: "title" });
    sheet.setView({ ...sheet.getState().view, sortBy: "priority" });

    expect(navigator.getState().view.sortBy).toBe("title");
    expect(sheet.getState().view.sortBy).toBe("priority");
    expect((storage.get("view:cross") as { sortBy: string }).sortBy).toBe(
      "title",
    );
    expect((storage.get("view:sheet") as { sortBy: string }).sortBy).toBe(
      "priority",
    );
  });

  it("the sheet scope round-trips under its own key and ignores setWorkspace", () => {
    const storage = createFakeStorage();
    const sheet = createPrefsStore(storage, SHEET_SCOPE);
    sheet.setHydrated(true);
    sheet.setWorkspace("w1");
    sheet.setView({ ...sheet.getState().view, groupBy: "label" });

    expect(readTaskPrefs(storage, SHEET_SCOPE).view.groupBy).toBe("label");
    expect(storage.get("view:w1")).toBeUndefined();
  });
});
