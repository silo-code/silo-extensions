import { describe, expect, it } from "vitest";
import { makeCtx } from "../test/fakes";
import { createProviderRegistry } from "../providers/registry";
import { SiloTaskProvider } from "../providers/silo/provider";
import { createSourceSet } from "./source-set";

function harness(opts: Parameters<typeof makeCtx>[0]) {
  const h = makeCtx(opts);
  const providers = createProviderRegistry();
  providers.register(new SiloTaskProvider(h.ctx.files, { debounceMs: 0 }));
  const set = createSourceSet(h.ctx, providers);
  return { ...h, set };
}

describe("createSourceSet", () => {
  it("resolves only the global source with no workspace open", async () => {
    const { set } = harness({ globalDir: "/cfg/silo.tasks/global" });
    await set.start();
    const state = set.getState();
    expect(state.sources).toHaveLength(1);
    expect(state.sources[0].scope).toBe("global");
    expect(state.sources[0].name).toBe("Personal");
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it("treats NoWorkspaceError as 'no workspace source', not an error", async () => {
    const { set, workspaces } = harness({ globalDir: "/cfg/g" });
    workspaces.setAll([
      { id: "w1", name: "Repo", folder: "/repo" },
    ] as never);
    workspaces.setActive("w1");
    // makeCtx with no workspaceDir throws NoWorkspaceError.
    await set.start();
    expect(set.getState().error).toBeNull();
    expect(set.getState().sources).toHaveLength(1);
  });

  it("surfaces a non-NoWorkspace storage rejection as an error", async () => {
    const { set, workspaces } = harness({
      globalDir: "/cfg/g",
      workspaceDir: async () => {
        throw new Error("disk on fire");
      },
    });
    workspaces.setAll([{ id: "w1", name: "Repo", folder: "/r" }] as never);
    workspaces.setActive("w1");
    await set.start();
    expect(set.getState().error).toMatch(/disk on fire/);
  });

  it("resolves the workspace source when a workspace is active", async () => {
    const { set, workspaces } = harness({
      globalDir: "/cfg/g",
      workspaceDir: "/cfg/ws/w1",
    });
    workspaces.setAll([{ id: "w1", name: "My Repo", folder: "/r" }] as never);
    workspaces.setActive("w1");
    await set.start();
    const scopes = set.getState().sources.map((s) => s.scope);
    expect(scopes).toEqual(["global", "workspace"]);
    expect(set.getState().sources[1].name).toBe("My Repo");
  });

  it("dedupes identical locators to one source", async () => {
    const { set, workspaces } = harness({
      globalDir: "/cfg/same",
      workspaceDir: "/cfg/same",
    });
    workspaces.setAll([{ id: "w1", name: "Repo", folder: "/r" }] as never);
    workspaces.setActive("w1");
    await set.start();
    expect(set.getState().sources).toHaveLength(1);
  });

  it("re-resolves and disposes the old watch on workspace change", async () => {
    const { set, files, workspaces } = harness({
      globalDir: "/cfg/g",
      workspaceDir: "/cfg/ws/w1",
    });
    workspaces.setAll([{ id: "w1", name: "R1", folder: "/r1" }] as never);
    workspaces.setActive("w1");
    await set.start();
    const withWorkspace = files.watcherCount();
    expect(withWorkspace).toBe(2);

    workspaces.setActive(null);
    await new Promise((r) => setTimeout(r, 0));
    expect(files.watcherCount()).toBe(1);
  });

  it("keeps a stable state identity when nothing actually changed", async () => {
    const { set } = harness({ globalDir: "/cfg/g" });
    await set.start();
    const first = set.getState();
    await set.refresh();
    expect(set.getState()).toBe(first);
  });
});
