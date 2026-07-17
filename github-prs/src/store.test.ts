import { describe, it, expect } from "vitest";
import { PrStore, type WorkspacePrState } from "./store";
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
    folder: "/repo",
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

describe("PrStore folder state + detail cache", () => {
  it("stores and retrieves folder states by workspace", () => {
    const store = new PrStore();
    store.setFolderState("ws-1", "/a", folderState({ folder: "/a", openPrs: [pr({ number: 1 })] }));
    store.setFolderState("ws-1", "/b", folderState({ folder: "/b", openPrs: [pr({ number: 2 })] }));
    store.setFolderState("ws-2", "/a", folderState({ folder: "/a", openPrs: [pr({ number: 3 })] }));
    expect(store.getRepoStates("ws-1")).toHaveLength(2);
    expect(store.getRepoStates("ws-2")).toHaveLength(1);
  });

  it("removeFolderState drops one folder", () => {
    const store = new PrStore();
    store.setFolderState("ws-1", "/a", folderState({ folder: "/a" }));
    store.setFolderState("ws-1", "/b", folderState({ folder: "/b" }));
    store.removeFolderState("ws-1", "/a");
    expect(store.getRepoStates("ws-1").map((s) => s.folder)).toEqual(["/b"]);
  });

  it("removeWorkspace drops all folders for that workspace", () => {
    const store = new PrStore();
    store.setFolderState("ws-1", "/a", folderState({ folder: "/a" }));
    store.setFolderState("ws-2", "/a", folderState({ folder: "/a" }));
    store.removeWorkspace("ws-1");
    expect(store.getRepoStates("ws-1")).toEqual([]);
    expect(store.getRepoStates("ws-2")).toHaveLength(1);
  });

  it("caches PR detail by folder+number", () => {
    const store = new PrStore();
    const detail = { ...pr(), body: "hi", reviews: [], comments: [], changedFiles: 2, closedAt: null } as PrDetail;
    store.setDetail("/repo", 42, detail);
    expect(store.getDetail("/repo", 42)?.detail.body).toBe("hi");
    expect(store.getDetail("/repo", 99)).toBeUndefined();
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

  it("tracks workspace ready separately from folder state", () => {
    const store = new PrStore();
    expect(store.isWorkspaceReady("ws-1")).toBe(false);
    store.markWorkspaceReady("ws-1");
    expect(store.isWorkspaceReady("ws-1")).toBe(true);
    store.removeWorkspace("ws-1");
    expect(store.isWorkspaceReady("ws-1")).toBe(false);
  });
});
