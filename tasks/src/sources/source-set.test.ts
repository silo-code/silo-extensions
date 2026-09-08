import { describe, expect, it } from "vitest";
import { makeCtx } from "../test/fakes";
import { createProviderRegistry } from "../providers/registry";
import { SiloTaskProvider } from "../providers/silo/provider";
import { createSourceSet, selectScopedSources } from "./source-set";

function harness(opts: Parameters<typeof makeCtx>[0]) {
  const h = makeCtx(opts);
  const providers = createProviderRegistry();
  providers.register(new SiloTaskProvider(h.ctx.files, { debounceMs: 0 }));
  const set = createSourceSet(h.ctx, providers);
  return { ...h, set };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("createSourceSet", () => {
  it("resolves only the global source with no workspace open", async () => {
    const { set } = harness({ globalDir: "/cfg/silo.tasks/global" });
    await set.start();
    const state = set.getState();
    expect(state.sources).toHaveLength(1);
    expect(state.sources[0].scope).toBe("global");
    expect(state.sources[0].name).toBe("");
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it("resolves one source per open workspace plus the global list", async () => {
    const { set, workspaces } = harness({
      globalDir: "/cfg/g",
      workspaceDirs: { w1: "/cfg/ws/w1", w2: "/cfg/ws/w2", w3: "/cfg/ws/w3" },
    });
    workspaces.setAll([
      { id: "w1", name: "Alpha", folder: "/a" },
      { id: "w2", name: "Beta", folder: "/b" },
      { id: "w3", name: "Gamma", folder: "/c" },
    ] as never);
    workspaces.setActive("w1");
    await set.start();

    const sources = set.getState().sources;
    expect(sources).toHaveLength(4);
    expect(sources[0].scope).toBe("global");
    expect(sources.map((s) => s.name)).toEqual([
      "",
      "Alpha",
      "Beta",
      "Gamma",
    ]);
    // Every source loaded, none errored — an absent file is an empty list.
    expect(set.getState().errorsBySource.size).toBe(0);
    for (const s of sources) {
      expect(set.getState().tasksBySource.get(s.id)).toEqual([]);
    }
  });

  it("resolves a workspace with no tasks file as an empty source, not an error", async () => {
    const { set, files, workspaces } = harness({
      globalDir: "/cfg/g",
      workspaceDirs: { w1: "/cfg/ws/w1", w2: "/cfg/ws/w2" },
    });
    files.seed(
      "/cfg/ws/w1/tasks.jsonl",
      JSON.stringify({
        v: 1,
        id: "t1",
        title: "Has a file",
        lane: "todo",
        priority: "normal",
        labels: [],
        rank: "a",
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    workspaces.setAll([
      { id: "w1", name: "Alpha", folder: "/a" },
      { id: "w2", name: "Beta", folder: "/b" },
    ] as never);
    await set.start();

    const [, alpha, beta] = set.getState().sources;
    expect(set.getState().tasksBySource.get(alpha.id)).toHaveLength(1);
    expect(set.getState().tasksBySource.get(beta.id)).toEqual([]);
    expect(set.getState().error).toBeNull();
    expect(set.getState().errorsBySource.size).toBe(0);
  });

  it("contributes no source for a closed workspace", async () => {
    const { set, workspaces } = harness({
      globalDir: "/cfg/g",
      workspaceDirs: { w1: "/cfg/ws/w1" },
    });
    // `setAll` only ever lists open workspaces; w2 is closed, so it never gets
    // a directory and never becomes a source.
    workspaces.setAll([{ id: "w1", name: "Alpha", folder: "/a" }] as never);
    await set.start();
    expect(set.getState().sources.map((s) => s.workspaceId)).toEqual([
      undefined,
      "w1",
    ]);
  });

  it("dedupes workspaces that resolve to the same locator", async () => {
    const { set, workspaces } = harness({
      globalDir: "/cfg/g",
      // Two worktrees of one repo sharing a storage dir.
      workspaceDirs: { w1: "/cfg/ws/shared", w2: "/cfg/ws/shared" },
    });
    workspaces.setAll([
      { id: "w1", name: "Main", folder: "/r" },
      { id: "w2", name: "Worktree", folder: "/r-wt" },
    ] as never);
    await set.start();
    expect(set.getState().sources).toHaveLength(2);
    expect(set.getState().sources[1].name).toBe("Main");
  });

  it("dedupes a workspace locator identical to the global one", async () => {
    const { set, workspaces } = harness({
      globalDir: "/cfg/same",
      workspaceDirs: { w1: "/cfg/same" },
    });
    workspaces.setAll([{ id: "w1", name: "Repo", folder: "/r" }] as never);
    await set.start();
    expect(set.getState().sources).toHaveLength(1);
  });

  it("surfaces a wholesale storage rejection as a set-level error", async () => {
    const { set, workspaces } = harness({
      globalDir: "/cfg/g",
      workspaceDirs: async () => {
        throw new Error("disk on fire");
      },
    });
    workspaces.setAll([{ id: "w1", name: "Repo", folder: "/r" }] as never);
    await set.start();
    expect(set.getState().error).toMatch(/disk on fire/);
    expect(set.getState().sources).toEqual([]);
  });

  it("isolates one workspace's load failure from the rest", async () => {
    const { set, files, workspaces } = harness({
      globalDir: "/cfg/g",
      workspaceDirs: { w1: "/cfg/ws/w1", w2: "/cfg/ws/w2" },
    });
    files.seed("/cfg/ws/w2/tasks.jsonl", "");
    // A read that blows up for w2's file only.
    const realRead = files.readText.bind(files);
    files.readText = async (p: string) => {
      if (p === "/cfg/ws/w2/tasks.jsonl") throw new Error("EIO");
      return realRead(p);
    };
    workspaces.setAll([
      { id: "w1", name: "Alpha", folder: "/a" },
      { id: "w2", name: "Beta", folder: "/b" },
    ] as never);
    await set.start();

    const state = set.getState();
    expect(state.error).toBeNull();
    expect(state.sources).toHaveLength(3);
    const beta = state.sources.find((s) => s.name === "Beta")!;
    expect(state.errorsBySource.get(beta.id)).toMatch(/EIO/);
    expect(state.tasksBySource.get(beta.id)).toEqual([]);
    // Alpha and the global list are untouched.
    const alpha = state.sources.find((s) => s.name === "Alpha")!;
    expect(state.errorsBySource.has(alpha.id)).toBe(false);
  });

  it("adds a source and its watch when a workspace opens", async () => {
    const { set, files, workspaces } = harness({
      globalDir: "/cfg/g",
      workspaceDirs: { w1: "/cfg/ws/w1", w2: "/cfg/ws/w2" },
    });
    workspaces.setAll([{ id: "w1", name: "Alpha", folder: "/a" }] as never);
    await set.start();
    expect(set.getState().sources).toHaveLength(2);
    expect(files.watcherCount()).toBe(2);
    const alphaId = set.getState().sources[1].id;

    workspaces.setAll([
      { id: "w1", name: "Alpha", folder: "/a" },
      { id: "w2", name: "Beta", folder: "/b" },
    ] as never);
    await flush();

    expect(set.getState().sources).toHaveLength(3);
    expect(files.watcherCount()).toBe(3);
    // The already-loaded source kept its identity and its list.
    expect(set.getState().sources[1].id).toBe(alphaId);
    expect(set.getState().tasksBySource.get(alphaId)).toEqual([]);
  });

  it("drops a source and its watch when a workspace closes, with no leak", async () => {
    const { set, files, workspaces } = harness({
      globalDir: "/cfg/g",
      workspaceDirs: { w1: "/cfg/ws/w1", w2: "/cfg/ws/w2" },
    });
    workspaces.setAll([
      { id: "w1", name: "Alpha", folder: "/a" },
      { id: "w2", name: "Beta", folder: "/b" },
    ] as never);
    await set.start();
    expect(files.watcherCount()).toBe(3);

    workspaces.setAll([{ id: "w1", name: "Alpha", folder: "/a" }] as never);
    await flush();
    expect(set.getState().sources).toHaveLength(2);
    expect(files.watcherCount()).toBe(2);

    // Re-open: back to three, still no accumulation.
    workspaces.setAll([
      { id: "w1", name: "Alpha", folder: "/a" },
      { id: "w2", name: "Beta", folder: "/b" },
    ] as never);
    await flush();
    expect(files.watcherCount()).toBe(3);
  });

  it("does not re-resolve when only the active workspace changes", async () => {
    const { set, workspaces, logs } = harness({
      globalDir: "/cfg/g",
      workspaceDirs: { w1: "/cfg/ws/w1", w2: "/cfg/ws/w2" },
    });
    workspaces.setAll([
      { id: "w1", name: "Alpha", folder: "/a" },
      { id: "w2", name: "Beta", folder: "/b" },
    ] as never);
    await set.start();
    const resolves = () => logs.filter((l) => /^resolved /.test(l.message)).length;
    const before = resolves();

    workspaces.setActive("w2");
    await flush();
    expect(resolves()).toBe(before);
  });

  it("disposes every watch on dispose", async () => {
    const { set, files, workspaces } = harness({
      globalDir: "/cfg/g",
      workspaceDirs: { w1: "/cfg/ws/w1", w2: "/cfg/ws/w2" },
    });
    workspaces.setAll([
      { id: "w1", name: "Alpha", folder: "/a" },
      { id: "w2", name: "Beta", folder: "/b" },
    ] as never);
    await set.start();
    expect(files.watcherCount()).toBe(3);
    set.dispose();
    expect(files.watcherCount()).toBe(0);
  });

  it("keeps a stable state identity when nothing actually changed", async () => {
    const { set } = harness({ globalDir: "/cfg/g" });
    await set.start();
    const first = set.getState();
    await set.refresh();
    expect(set.getState()).toBe(first);
  });
});

describe("resolveDestination", () => {
  it("targets the active workspace's source, not whichever sorts first", async () => {
    const { set, workspaces } = harness({
      globalDir: "/cfg/g",
      workspaceDirs: { w1: "/cfg/ws/w1", w2: "/cfg/ws/w2" },
    });
    workspaces.setAll([
      { id: "w1", name: "Alpha", folder: "/a" },
      { id: "w2", name: "Beta", folder: "/b" },
    ] as never);
    workspaces.setActive("w2");
    await set.start();

    expect(set.resolveDestination("workspace")?.name).toBe("Beta");
    expect(set.resolveDestination("global")?.name).toBe("");
  });

  it("falls back to the global list when no workspace is active", async () => {
    const { set, workspaces } = harness({
      globalDir: "/cfg/g",
      workspaceDirs: { w1: "/cfg/ws/w1" },
    });
    workspaces.setAll([{ id: "w1", name: "Alpha", folder: "/a" }] as never);
    await set.start();
    expect(set.resolveDestination("workspace")?.name).toBe("");
  });
});

describe("selectScopedSources", () => {
  const sources = [
    { id: "g", scope: "global", name: "Personal" },
    { id: "a", scope: "workspace", workspaceId: "w1", name: "Alpha" },
    { id: "b", scope: "workspace", workspaceId: "w2", name: "Beta" },
  ] as never as Parameters<typeof selectScopedSources>[0];

  it("keeps the global source and the active workspace's, in order", () => {
    expect(selectScopedSources(sources, "w2").map((s) => s.name)).toEqual([
      "Personal",
      "Beta",
    ]);
  });

  it("keeps only the global source when no workspace is active", () => {
    expect(selectScopedSources(sources, null).map((s) => s.name)).toEqual([
      "Personal",
    ]);
  });
});
