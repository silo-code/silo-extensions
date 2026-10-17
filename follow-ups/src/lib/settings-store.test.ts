import { describe, expect, it, vi } from "vitest";
import { fakeStorage } from "../test/fake-storage";
import {
  defaultLabel,
  reorderLabels,
  renameLabel,
  setDefaultLabel,
  SHIPPED_NAMES,
} from "./labels";
import {
  STORAGE_KEY_LABELS,
  defaultLabelId,
  initSettings,
} from "./settings-store";

describe("initSettings — reading", () => {
  it("is the shipped defaults for an empty bag", () => {
    const store = initSettings(fakeStorage());
    const s = store.getState();
    expect(s.labels).toHaveLength(5);
    expect(defaultLabelId(s)).toBe("warn");
    store.dispose();
  });

  it("reads a persisted bag through the coerce guards", () => {
    const store = initSettings(
      fakeStorage({
        [STORAGE_KEY_LABELS]: [
          { id: "error", name: "Stuck", isDefault: true },
          { id: "purple", name: "Nope" },
        ],
      }),
    );
    const s = store.getState();
    expect(s.labels).toHaveLength(5);
    expect(s.labels[0]).toEqual({ id: "error", name: "Stuck", isDefault: true });
    store.dispose();
  });

  it("re-reads on subscribe, because storage hydrates asynchronously", () => {
    // The first read legitimately returns the shipped defaults; the
    // `storage.subscribe` fire on hydration is what corrects it.
    const storage = fakeStorage();
    const store = initSettings(storage);
    const seen = vi.fn();
    store.subscribe(seen);
    expect(store.getState().labels[0].name).toBe(SHIPPED_NAMES.warn);

    storage.seed(STORAGE_KEY_LABELS, [{ id: "ok", name: "Review", isDefault: true }]);
    storage.fire();

    expect(store.getState().labels[0]).toEqual({
      id: "ok",
      name: "Review",
      isDefault: true,
    });
    expect(seen).toHaveBeenCalledOnce();
    store.dispose();
  });

  it("does not emit when a storage fire changes nothing", () => {
    const storage = fakeStorage();
    const store = initSettings(storage);
    const seen = vi.fn();
    store.subscribe(seen);
    storage.fire();
    storage.fire();
    expect(seen).not.toHaveBeenCalled();
    store.dispose();
  });

  it("stops re-reading once disposed", () => {
    const storage = fakeStorage();
    const store = initSettings(storage);
    store.dispose();
    storage.seed(STORAGE_KEY_LABELS, [{ id: "ok", name: "Review", isDefault: true }]);
    storage.fire();
    expect(store.getState().labels[0].name).toBe(SHIPPED_NAMES.warn);
  });
});

describe("initSettings — writing", () => {
  it("persists a rename and emits once, not twice", () => {
    const storage = fakeStorage();
    const store = initSettings(storage);
    const seen = vi.fn();
    store.subscribe(seen);

    store.setLabels(renameLabel(store.getState().labels, "ok", "Peer review"));

    // One emit: the in-memory state is updated *before* the write, so the
    // storage subscriber sees no diff and stays quiet.
    expect(seen).toHaveBeenCalledOnce();
    expect(store.getState().labels[1].name).toBe("Peer review");
    expect(
      (storage.get(STORAGE_KEY_LABELS) as { id: string; name: string }[])[1],
    ).toEqual({ id: "ok", name: "Peer review", isDefault: false });
    store.dispose();
  });

  it("persists a reorder and a new default", () => {
    const storage = fakeStorage();
    const store = initSettings(storage);
    store.setLabels(reorderLabels(store.getState().labels, 0, 4));
    store.setLabels(setDefaultLabel(store.getState().labels, "muted"));
    expect(store.getState().labels.map((l) => l.id)).toEqual([
      "ok",
      "error",
      "info",
      "muted",
      "warn",
    ]);
    expect(defaultLabel(store.getState().labels).id).toBe("muted");

    // A fresh store over the same bag reads back exactly that.
    const reloaded = initSettings(storage);
    expect(reloaded.getState().labels.map((l) => l.id)).toEqual([
      "ok",
      "error",
      "info",
      "muted",
      "warn",
    ]);
    expect(defaultLabelId(reloaded.getState())).toBe("muted");
    store.dispose();
    reloaded.dispose();
  });

  it("re-coerces on write, so a caller can't install a broken list", () => {
    const storage = fakeStorage();
    const store = initSettings(storage);
    // Two defaults and only two labels — both invariants violated.
    store.setLabels([
      { id: "ok", name: "A", isDefault: true },
      { id: "error", name: "B", isDefault: true },
    ]);
    const s = store.getState();
    expect(s.labels).toHaveLength(5);
    expect(s.labels.filter((l) => l.isDefault)).toHaveLength(1);
    expect(defaultLabelId(s)).toBe("ok");
    store.dispose();
  });

  it("writes nothing when the list is unchanged", () => {
    const storage = fakeStorage();
    const store = initSettings(storage);
    const seen = vi.fn();
    store.subscribe(seen);
    store.setLabels(store.getState().labels);
    expect(storage.writes).toBe(0);
    expect(seen).not.toHaveBeenCalled();
    store.dispose();
  });

});
