import { describe, it, expect } from "vitest";
import { IssueStore, preferredFetchCwd, type WorkspaceIssueState } from "./store";
import type { IssueDetail, IssueListItem } from "./github-issue-api";

function issue(partial: Partial<IssueListItem> = {}): IssueListItem {
  return {
    number: 1,
    title: "Test",
    url: "https://github.com/o/r/issues/1",
    author: { login: "dave" },
    state: "OPEN",
    stateReason: null,
    labels: [],
    assignees: [],
    milestone: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    closedAt: null,
    ...partial,
  };
}

function folderState(overrides: Partial<WorkspaceIssueState> = {}): WorkspaceIssueState {
  return {
    folders: [{ path: "/repo" }],
    repoInfo: { owner: "o", repo: "r" },
    openIssues: [],
    closedIssues: [],
    lastFetched: null,
    error: null,
    ...overrides,
  };
}

describe("IssueStore.getWorkspaceEnabled / setWorkspaceEnabled", () => {
  it("defaults to true for a workspace with no stored value", () => {
    const store = new IssueStore();
    expect(store.getWorkspaceEnabled("ws-unseen")).toBe(true);
  });

  it("round-trips an explicit false", () => {
    const store = new IssueStore();
    store.setWorkspaceEnabled("ws-1", false);
    expect(store.getWorkspaceEnabled("ws-1")).toBe(false);
  });

  it("tracks each workspace independently", () => {
    const store = new IssueStore();
    store.setWorkspaceEnabled("ws-1", false);
    expect(store.getWorkspaceEnabled("ws-1")).toBe(false);
    expect(store.getWorkspaceEnabled("ws-2")).toBe(true);
  });

  it("notifies subscribers on change", () => {
    const store = new IssueStore();
    let calls = 0;
    const unsubscribe = store.subscribe(() => calls++);
    store.setWorkspaceEnabled("ws-1", false);
    expect(calls).toBe(1);
    unsubscribe();
    store.setWorkspaceEnabled("ws-1", true);
    expect(calls).toBe(1);
  });
});

describe("IssueStore.getWorkspaceFilter / setWorkspaceFilter", () => {
  it("defaults to assigned", () => {
    const store = new IssueStore();
    expect(store.getWorkspaceFilter("ws-1")).toBe("assigned");
  });

  it("round-trips a filter", () => {
    const store = new IssueStore();
    store.setWorkspaceFilter("ws-1", "closed");
    expect(store.getWorkspaceFilter("ws-1")).toBe("closed");
  });

  it("tracks filters per workspace", () => {
    const store = new IssueStore();
    store.setWorkspaceFilter("ws-1", "all");
    store.setWorkspaceFilter("ws-2", "authored");
    expect(store.getWorkspaceFilter("ws-1")).toBe("all");
    expect(store.getWorkspaceFilter("ws-2")).toBe("authored");
  });
});

describe("IssueStore repo state + detail cache", () => {
  it("stores and retrieves repo states by workspace", () => {
    const store = new IssueStore();
    store.setRepoState("ws-1", "o", "a", folderState({
      folders: [{ path: "/a" }],
      repoInfo: { owner: "o", repo: "a" },
      openIssues: [issue({ number: 1 })],
    }));
    store.setRepoState("ws-1", "o", "b", folderState({
      folders: [{ path: "/b" }],
      repoInfo: { owner: "o", repo: "b" },
      openIssues: [issue({ number: 2 })],
    }));
    store.setRepoState("ws-2", "o", "a", folderState({
      folders: [{ path: "/a" }],
      repoInfo: { owner: "o", repo: "a" },
      openIssues: [issue({ number: 3 })],
    }));
    expect(store.getRepoStates("ws-1")).toHaveLength(2);
    expect(store.getRepoStates("ws-2")).toHaveLength(1);
  });

  it("collapses multiple worktree folders into one remote entry", () => {
    const store = new IssueStore();
    store.setRepoState("ws-1", "o", "r", folderState({
      folders: [
        { path: "/wt-a" },
        { path: "/wt-b" },
      ],
      openIssues: [issue({ number: 1 })],
    }));
    expect(store.getRepoStates("ws-1")).toHaveLength(1);
    expect(store.getRepoStates("ws-1")[0].folders).toHaveLength(2);
  });

  it("removeRepoState drops one remote", () => {
    const store = new IssueStore();
    store.setRepoState("ws-1", "o", "a", folderState({
      folders: [{ path: "/a" }],
      repoInfo: { owner: "o", repo: "a" },
    }));
    store.setRepoState("ws-1", "o", "b", folderState({
      folders: [{ path: "/b" }],
      repoInfo: { owner: "o", repo: "b" },
    }));
    store.removeRepoState("ws-1", "o", "a");
    expect(store.getRepoStates("ws-1").map((s) => s.repoInfo?.repo)).toEqual(["b"]);
  });

  it("removeWorkspace drops all remotes for that workspace", () => {
    const store = new IssueStore();
    store.setRepoState("ws-1", "o", "a", folderState({
      folders: [{ path: "/a" }],
      repoInfo: { owner: "o", repo: "a" },
    }));
    store.setRepoState("ws-2", "o", "a", folderState({
      folders: [{ path: "/a" }],
      repoInfo: { owner: "o", repo: "a" },
    }));
    store.removeWorkspace("ws-1");
    expect(store.getRepoStates("ws-1")).toEqual([]);
    expect(store.getRepoStates("ws-2")).toHaveLength(1);
  });

  it("caches issue detail by repoKey+number", () => {
    const store = new IssueStore();
    const detail = { ...issue(), body: "hi", comments: [] } as IssueDetail;
    store.setDetail("o/r", 42, detail);
    expect(store.getDetail("o/r", 42)?.detail.body).toBe("hi");
    expect(store.getDetail("o/r", 99)).toBeUndefined();
  });

  it("setAuthState marks initialized and setViewerLogin stores login", () => {
    const store = new IssueStore();
    expect(store.initialized).toBe(false);
    store.setAuthState("ok");
    expect(store.initialized).toBe(true);
    expect(store.authenticated).toBe(true);
    store.setViewerLogin("dave");
    expect(store.viewerLogin).toBe("dave");
  });

  it("tracks workspace ready separately from repo state", () => {
    const store = new IssueStore();
    expect(store.isWorkspaceReady("ws-1")).toBe(false);
    store.markWorkspaceReady("ws-1");
    expect(store.isWorkspaceReady("ws-1")).toBe(true);
    store.removeWorkspace("ws-1");
    expect(store.isWorkspaceReady("ws-1")).toBe(false);
  });

  it("markWorkspaceReady is idempotent (notifies once)", () => {
    const store = new IssueStore();
    let calls = 0;
    store.subscribe(() => calls++);
    store.markWorkspaceReady("ws-1");
    store.markWorkspaceReady("ws-1");
    expect(calls).toBe(1);
    expect(store.isWorkspaceReady("ws-1")).toBe(true);
  });

  it("stores and clears detail-fetch errors", () => {
    const store = new IssueStore();
    store.setDetailError("o/r", 7, { kind: "rate-limited", message: "slow down" });
    expect(store.getDetailError("o/r", 7)?.error.message).toBe("slow down");
    store.setDetail("o/r", 7, {
      ...issue({ number: 7 }),
      body: "ok",
      comments: [],
    } as IssueDetail);
    expect(store.getDetailError("o/r", 7)).toBeUndefined();
    expect(store.getDetail("o/r", 7)?.detail.body).toBe("ok");
  });
});

describe("preferredFetchCwd", () => {
  it("prefers the workspace primary folder when present", () => {
    const folders = [
      { path: "/wt-a" },
      { path: "/primary" },
    ];
    expect(preferredFetchCwd("/primary", folders)).toBe("/primary");
    expect(preferredFetchCwd("/other", folders)).toBe("/wt-a");
  });
});

describe("IssueStore.hydrate", () => {
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

  it("loads enabled flags and filters from storage", () => {
    const store = new IssueStore();
    const storage = fakeStorage({
      workspaceEnabled: { "ws-1": false },
      workspaceFilter: { "ws-1": "closed" },
    });
    store.hydrate(storage);
    expect(store.getWorkspaceEnabled("ws-1")).toBe(false);
    expect(store.getWorkspaceFilter("ws-1")).toBe("closed");
  });

  it("persists enabled and filter changes through storage", () => {
    const store = new IssueStore();
    const storage = fakeStorage({});
    store.hydrate(storage);
    store.setWorkspaceEnabled("ws-9", false);
    store.setWorkspaceFilter("ws-9", "all");
    expect(storage.get("workspaceEnabled")).toEqual({ "ws-9": false });
    expect(storage.get("workspaceFilter")).toEqual({ "ws-9": "all" });
  });
});
