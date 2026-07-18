import { describe, it, expect } from "vitest";
import { PrStore, preferredFetchCwd, type WorkspacePrState } from "./store";
import type { PrDetail, PrListItem } from "./github-pr-api";

function pr(partial: Partial<PrListItem> = {}): PrListItem {
  return {
    number: 1,
    title: "Test",
    url: "https://github.com/o/r/pull/1",
    author: { login: "dave" },
    isDraft: false,
    state: "OPEN",
    reviewDecision: "",
    reviewRequests: [],
    latestReviews: [],
    statusCheckRollup: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    mergedAt: null,
    headRefName: "feat",
    baseRefName: "main",
    labels: [],
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    additions: 1,
    deletions: 0,
    ...partial,
  };
}

function folderState(overrides: Partial<WorkspacePrState> = {}): WorkspacePrState {
  return {
    folders: [{ path: "/repo", branch: "main" }],
    repoInfo: { owner: "o", repo: "r" },
    openPrs: [],
    mergedPrs: [],
    lastFetched: null,
    error: null,
    ...overrides,
  };
}

describe("PrStore.getWorkspaceEnabled / setWorkspaceEnabled", () => {
  it("defaults to true for a workspace with no stored value", () => {
    const store = new PrStore();
    expect(store.getWorkspaceEnabled("ws-unseen")).toBe(true);
  });

  it("round-trips an explicit false", () => {
    const store = new PrStore();
    store.setWorkspaceEnabled("ws-1", false);
    expect(store.getWorkspaceEnabled("ws-1")).toBe(false);
  });

  it("tracks each workspace independently", () => {
    const store = new PrStore();
    store.setWorkspaceEnabled("ws-1", false);
    expect(store.getWorkspaceEnabled("ws-1")).toBe(false);
    expect(store.getWorkspaceEnabled("ws-2")).toBe(true);
  });

  it("notifies subscribers on change", () => {
    const store = new PrStore();
    let calls = 0;
    const unsubscribe = store.subscribe(() => calls++);
    store.setWorkspaceEnabled("ws-1", false);
    expect(calls).toBe(1);
    unsubscribe();
    store.setWorkspaceEnabled("ws-1", true);
    expect(calls).toBe(1);
  });
});

describe("PrStore.getWorkspaceFilter / setWorkspaceFilter", () => {
  it("defaults to authored", () => {
    const store = new PrStore();
    expect(store.getWorkspaceFilter("ws-1")).toBe("authored");
  });

  it("round-trips a filter", () => {
    const store = new PrStore();
    store.setWorkspaceFilter("ws-1", "merged");
    expect(store.getWorkspaceFilter("ws-1")).toBe("merged");
  });

  it("tracks filters per workspace", () => {
    const store = new PrStore();
    store.setWorkspaceFilter("ws-1", "all");
    store.setWorkspaceFilter("ws-2", "review-requested");
    expect(store.getWorkspaceFilter("ws-1")).toBe("all");
    expect(store.getWorkspaceFilter("ws-2")).toBe("review-requested");
  });
});

describe("PrStore repo state + detail cache", () => {
  it("stores and retrieves repo states by workspace", () => {
    const store = new PrStore();
    store.setRepoState("ws-1", "o", "a", folderState({
      folders: [{ path: "/a", branch: "main" }],
      repoInfo: { owner: "o", repo: "a" },
      openPrs: [pr({ number: 1 })],
    }));
    store.setRepoState("ws-1", "o", "b", folderState({
      folders: [{ path: "/b", branch: "main" }],
      repoInfo: { owner: "o", repo: "b" },
      openPrs: [pr({ number: 2 })],
    }));
    store.setRepoState("ws-2", "o", "a", folderState({
      folders: [{ path: "/a", branch: "main" }],
      repoInfo: { owner: "o", repo: "a" },
      openPrs: [pr({ number: 3 })],
    }));
    expect(store.getRepoStates("ws-1")).toHaveLength(2);
    expect(store.getRepoStates("ws-2")).toHaveLength(1);
  });

  it("collapses multiple worktree folders into one remote entry", () => {
    const store = new PrStore();
    store.setRepoState("ws-1", "o", "r", folderState({
      folders: [
        { path: "/wt-a", branch: "feat/a" },
        { path: "/wt-b", branch: "feat/b" },
      ],
      openPrs: [pr({ number: 1 })],
    }));
    expect(store.getRepoStates("ws-1")).toHaveLength(1);
    expect(store.getRepoStates("ws-1")[0].folders).toHaveLength(2);
  });

  it("removeRepoState drops one remote", () => {
    const store = new PrStore();
    store.setRepoState("ws-1", "o", "a", folderState({
      folders: [{ path: "/a", branch: "main" }],
      repoInfo: { owner: "o", repo: "a" },
    }));
    store.setRepoState("ws-1", "o", "b", folderState({
      folders: [{ path: "/b", branch: "main" }],
      repoInfo: { owner: "o", repo: "b" },
    }));
    store.removeRepoState("ws-1", "o", "a");
    expect(store.getRepoStates("ws-1").map((s) => s.repoInfo?.repo)).toEqual(["b"]);
  });

  it("removeWorkspace drops all remotes for that workspace", () => {
    const store = new PrStore();
    store.setRepoState("ws-1", "o", "a", folderState({
      folders: [{ path: "/a", branch: "main" }],
      repoInfo: { owner: "o", repo: "a" },
    }));
    store.setRepoState("ws-2", "o", "a", folderState({
      folders: [{ path: "/a", branch: "main" }],
      repoInfo: { owner: "o", repo: "a" },
    }));
    store.removeWorkspace("ws-1");
    expect(store.getRepoStates("ws-1")).toEqual([]);
    expect(store.getRepoStates("ws-2")).toHaveLength(1);
  });

  it("caches PR detail by repoKey+number", () => {
    const store = new PrStore();
    const detail = { ...pr(), body: "hi", reviews: [], comments: [], changedFiles: 2, closedAt: null } as PrDetail;
    store.setDetail("o/r", 42, detail);
    expect(store.getDetail("o/r", 42)?.detail.body).toBe("hi");
    expect(store.getDetail("o/r", 99)).toBeUndefined();
  });

  it("setAuthState marks initialized and setViewerLogin stores login", () => {
    const store = new PrStore();
    expect(store.initialized).toBe(false);
    store.setAuthState("ok");
    expect(store.initialized).toBe(true);
    expect(store.authenticated).toBe(true);
    store.setViewerLogin("dave");
    expect(store.viewerLogin).toBe("dave");
  });

  it("updateSettings patches and notifies", () => {
    const store = new PrStore();
    let calls = 0;
    store.subscribe(() => calls++);
    store.updateSettings({ activePollIntervalMs: 30_000 });
    expect(store.settings.activePollIntervalMs).toBe(30_000);
    expect(store.settings.inactivePollIntervalMs).toBe(10 * 60_000);
    expect(calls).toBe(1);
  });

  it("tracks workspace ready separately from repo state", () => {
    const store = new PrStore();
    expect(store.isWorkspaceReady("ws-1")).toBe(false);
    store.markWorkspaceReady("ws-1");
    expect(store.isWorkspaceReady("ws-1")).toBe(true);
    store.removeWorkspace("ws-1");
    expect(store.isWorkspaceReady("ws-1")).toBe(false);
  });

  it("markWorkspaceReady is idempotent (notifies once)", () => {
    const store = new PrStore();
    let calls = 0;
    store.subscribe(() => calls++);
    store.markWorkspaceReady("ws-1");
    store.markWorkspaceReady("ws-1");
    expect(calls).toBe(1);
    expect(store.isWorkspaceReady("ws-1")).toBe(true);
  });

  it("stores and clears detail-fetch errors", () => {
    const store = new PrStore();
    store.setDetailError("o/r", 7, { kind: "rate-limited", message: "slow down" });
    expect(store.getDetailError("o/r", 7)?.error.message).toBe("slow down");
    store.setDetail("o/r", 7, {
      ...pr({ number: 7 }),
      body: "ok",
      reviews: [],
      comments: [],
      changedFiles: 1,
      closedAt: null,
    } as PrDetail);
    expect(store.getDetailError("o/r", 7)).toBeUndefined();
    expect(store.getDetail("o/r", 7)?.detail.body).toBe("ok");
  });
});

describe("preferredFetchCwd", () => {
  it("prefers the workspace primary folder when present", () => {
    const folders = [
      { path: "/wt-a", branch: "feat/a" },
      { path: "/primary", branch: "main" },
    ];
    expect(preferredFetchCwd("/primary", folders)).toBe("/primary");
    expect(preferredFetchCwd("/other", folders)).toBe("/wt-a");
  });
});

describe("PrStore.hydrate", () => {
  function fakeStorage(initial: Record<string, unknown> = {}) {
    const data = new Map<string, unknown>(Object.entries(initial));
    const listeners = new Set<() => void>();
    return {
      get: ((key: string, fallback?: unknown) =>
        data.has(key) ? data.get(key) : fallback) as import("@silo-code/sdk").ExtensionStorage["get"],
      set(key: string, value: unknown) {
        if (value === undefined) data.delete(key);
        else data.set(key, value);
      },
      keys: () => [...data.keys()],
      subscribe(listener: () => void) {
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
      },
      emit() {
        for (const l of listeners) l();
      },
    };
  }

  it("loads enabled flags, filters, and settings from storage", () => {
    const store = new PrStore();
    const storage = fakeStorage({
      workspaceEnabled: { "ws-1": false },
      workspaceFilter: { "ws-1": "merged" },
      settings: { activePollIntervalMs: 30_000 },
    });
    store.hydrate(storage);
    expect(store.getWorkspaceEnabled("ws-1")).toBe(false);
    expect(store.getWorkspaceFilter("ws-1")).toBe("merged");
    expect(store.settings.activePollIntervalMs).toBe(30_000);
    expect(store.settings.inactivePollIntervalMs).toBe(10 * 60_000);
  });

  it("re-applies settings when storage notifies after hydrate", () => {
    const store = new PrStore();
    const storage = fakeStorage({});
    store.hydrate(storage);
    storage.set("settings", { inactivePollIntervalMs: 5 * 60_000 });
    storage.emit();
    expect(store.settings.inactivePollIntervalMs).toBe(5 * 60_000);
  });

  it("persists enabled and filter changes through storage", () => {
    const store = new PrStore();
    const storage = fakeStorage({});
    store.hydrate(storage);
    store.setWorkspaceEnabled("ws-9", false);
    store.setWorkspaceFilter("ws-9", "all");
    expect(storage.get("workspaceEnabled")).toEqual({ "ws-9": false });
    expect(storage.get("workspaceFilter")).toEqual({ "ws-9": "all" });
  });
});
