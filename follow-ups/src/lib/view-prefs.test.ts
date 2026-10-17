import { describe, expect, it, vi } from "vitest";
import { fakeStorage } from "../test/fake-storage";
import {
  DEFAULT_GROUP_BY,
  STORAGE_KEY_VIEW,
  coerceViewPrefs,
  createViewPrefsStore,
} from "./view-prefs";

describe("coerceViewPrefs", () => {
  it("is the default for anything that isn't an object", () => {
    for (const raw of [undefined, null, "nope", 7, true]) {
      expect(coerceViewPrefs(raw)).toEqual({
        groupBy: DEFAULT_GROUP_BY,
        collapsedGroups: {},
      });
    }
  });

  it("keeps a known groupBy and rejects an unknown one", () => {
    expect(coerceViewPrefs({ groupBy: "label" }).groupBy).toBe("label");
    expect(coerceViewPrefs({ groupBy: "phase" }).groupBy).toBe(DEFAULT_GROUP_BY);
  });

  it("keeps only the collapsed-true keys", () => {
    expect(
      coerceViewPrefs({
        collapsedGroups: { a: true, b: false, c: "yes", d: 1 },
      }).collapsedGroups,
    ).toEqual({ a: true });
  });

  it("tolerates a non-object collapsedGroups", () => {
    expect(coerceViewPrefs({ collapsedGroups: "nope" }).collapsedGroups).toEqual(
      {},
    );
  });
});

describe("createViewPrefsStore", () => {
  it("reads the persisted value up front", () => {
    const store = createViewPrefsStore(
      fakeStorage({ [STORAGE_KEY_VIEW]: { groupBy: "label" } }),
    );
    expect(store.getState().groupBy).toBe("label");
    store.dispose();
  });

  it("drops a write before hydration rather than clobbering last session", () => {
    // `NavigatorViewProps` has no `hydrated` flag, so the view can render — and
    // the user can flip the control — before storage has loaded.
    const storage = fakeStorage();
    const store = createViewPrefsStore(storage);
    store.setGroupBy("label");
    expect(storage.writes).toBe(0);
    expect(store.getState().groupBy).toBe(DEFAULT_GROUP_BY);
    store.dispose();
  });

  it("re-reads when hydration lands, then accepts writes", () => {
    const storage = fakeStorage();
    const store = createViewPrefsStore(storage);
    const seen = vi.fn();
    store.subscribe(seen);

    storage.seed(STORAGE_KEY_VIEW, { groupBy: "none", collapsedGroups: { ws1: true } });
    store.setHydrated(true);

    expect(store.getState()).toEqual({
      groupBy: "none",
      collapsedGroups: { ws1: true },
    });
    expect(seen).toHaveBeenCalledOnce();

    store.setGroupBy("label");
    expect(storage.get(STORAGE_KEY_VIEW)).toEqual({
      groupBy: "label",
      collapsedGroups: { ws1: true },
    });
    store.dispose();
  });

  it("emits once per change — the storage subscriber sees no diff", () => {
    const storage = fakeStorage();
    const store = createViewPrefsStore(storage);
    store.setHydrated(true);
    const seen = vi.fn();
    store.subscribe(seen);
    store.setGroupBy("label");
    expect(seen).toHaveBeenCalledOnce();
    store.dispose();
  });

  it("ignores a no-op groupBy change", () => {
    const storage = fakeStorage();
    const store = createViewPrefsStore(storage);
    store.setHydrated(true);
    store.setGroupBy(DEFAULT_GROUP_BY);
    expect(storage.writes).toBe(0);
    store.dispose();
  });

  it("toggles a group collapsed and back, deleting rather than storing false", () => {
    const storage = fakeStorage();
    const store = createViewPrefsStore(storage);
    store.setHydrated(true);

    store.toggleGroup("ws1");
    expect(store.getState().collapsedGroups).toEqual({ ws1: true });

    store.toggleGroup("ws1");
    expect(store.getState().collapsedGroups).toEqual({});
    expect(storage.get(STORAGE_KEY_VIEW)).toEqual({
      groupBy: DEFAULT_GROUP_BY,
      collapsedGroups: {},
    });
    store.dispose();
  });

  it("stops re-reading once disposed", () => {
    const storage = fakeStorage();
    const store = createViewPrefsStore(storage);
    store.dispose();
    storage.seed(STORAGE_KEY_VIEW, { groupBy: "label" });
    storage.fire();
    expect(store.getState().groupBy).toBe(DEFAULT_GROUP_BY);
  });
});
