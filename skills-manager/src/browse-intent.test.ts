import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  onBrowseSheetRequest,
  requestBrowseSheet,
  resetBrowseSheetBus,
} from "./browse-intent";

describe("browse-intent", () => {
  beforeEach(() => {
    resetBrowseSheetBus();
  });

  it("notifies live subscribers", () => {
    const fn = vi.fn();
    const off = onBrowseSheetRequest(fn);
    requestBrowseSheet();
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    requestBrowseSheet();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("replays a pending request to a late subscriber", async () => {
    requestBrowseSheet();
    const fn = vi.fn();
    onBrowseSheetRequest(fn);
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("notifies every subscribed listener", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onBrowseSheetRequest(a);
    onBrowseSheetRequest(b);
    requestBrowseSheet();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    offA();
    requestBrowseSheet();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it("keeps notifying other listeners when one throws", () => {
    const bad = vi.fn(() => {
      throw new Error("boom");
    });
    const good = vi.fn();
    onBrowseSheetRequest(bad);
    onBrowseSheetRequest(good);

    expect(() => requestBrowseSheet()).not.toThrow();
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
  });

  it("replays a pending request without throwing when the listener throws", async () => {
    requestBrowseSheet();
    const bad = vi.fn(() => {
      throw new Error("boom");
    });
    onBrowseSheetRequest(bad);
    await Promise.resolve();
    expect(bad).toHaveBeenCalledTimes(1);
  });
});
