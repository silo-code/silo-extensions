import { describe, expect, it, vi } from "vitest";
import { makeCtx } from "./test/fakes";
import { createProviderRegistry } from "./providers/registry";
import { SiloTaskProvider } from "./providers/silo/provider";
import { createSourceSet } from "./sources/source-set";
import { createPanelBridge } from "./ui/panel-bridge";
import { createCommands } from "./commands";

async function harness(opts?: Parameters<typeof makeCtx>[0]) {
  const h = makeCtx(opts ?? { globalDir: "/cfg/g" });
  const providers = createProviderRegistry();
  providers.register(new SiloTaskProvider(h.ctx.files, { debounceMs: 0 }));
  const sourceSet = createSourceSet(h.ctx, providers);
  await sourceSet.start();
  const bridge = createPanelBridge();
  const revealPanel = vi.fn();
  const notify = vi.fn();
  const commands = createCommands({ sourceSet, bridge, revealPanel, notify });
  return { ...h, sourceSet, bridge, commands, revealPanel, notify };
}

describe("createCommands", () => {
  it("newTask with a title creates and returns the task", async () => {
    const { commands, sourceSet } = await harness();
    const task = await commands.newTask("Write the RFC");
    expect(task?.title).toBe("Write the RFC");
    expect(sourceSet.getState().sources).toHaveLength(1);
  });

  it("newTask targets the workspace source when a workspace is open", async () => {
    const { commands, sourceSet, workspaces } = await harness({
      globalDir: "/cfg/g",
      workspaceDir: "/cfg/ws/w1",
    });
    workspaces.setAll([{ id: "w1", name: "Repo", folder: "/r" }] as never);
    workspaces.setActive("w1");
    await new Promise((r) => setTimeout(r, 0));
    const task = await commands.newTask("In the repo");
    const wsSource = sourceSet.getState().sources.find((s) => s.scope === "workspace");
    expect(task?.sourceId).toBe(wsSource?.id);
  });

  it("newTask with no title reveals the panel and resolves undefined", async () => {
    const { commands, revealPanel, bridge } = await harness();
    const focus = vi.fn();
    bridge.focusQuickAdd = focus;
    await expect(commands.newTask()).resolves.toBeUndefined();
    expect(revealPanel).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
  });

  it("newInGlobal with a title always creates in the global list", async () => {
    const { commands, sourceSet, workspaces } = await harness({
      globalDir: "/cfg/g",
      workspaceDir: "/cfg/ws/w1",
    });
    workspaces.setAll([{ id: "w1", name: "Repo", folder: "/r" }] as never);
    workspaces.setActive("w1");
    await new Promise((r) => setTimeout(r, 0));
    const task = await commands.newInGlobal("Personal note");
    const global = sourceSet.getState().sources.find((s) => s.scope === "global");
    expect(task?.sourceId).toBe(global?.id);
  });

  it("complete by id resolves the updated task", async () => {
    const { commands } = await harness();
    const created = await commands.newTask("Do it");
    const done = await commands.complete(created!.id);
    expect(done?.lane).toBe("done");
  });

  it("complete with no arg completes the drilled-into task", async () => {
    const { commands, bridge } = await harness();
    const created = await commands.newTask("Drilled");
    bridge.drilledTaskId = created!.id;
    const done = await commands.complete();
    expect(done?.lane).toBe("done");
  });

  it("complete with no arg and no drill-in reveals + notifies", async () => {
    const { commands, revealPanel, notify } = await harness();
    await expect(commands.complete()).resolves.toBeUndefined();
    expect(revealPanel).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("info", expect.stringMatching(/Select/));
  });

  it("complete with an unknown id rejects naming the id and mutates nothing", async () => {
    const { commands, files } = await harness();
    await commands.newTask("Untouched");
    const before = files.peek("/cfg/g/tasks.jsonl");
    await expect(commands.complete("ghost-42")).rejects.toThrow(/ghost-42/);
    expect(files.peek("/cfg/g/tasks.jsonl")).toBe(before);
  });

  it("refresh always resolves", async () => {
    const { commands } = await harness();
    await expect(commands.refresh()).resolves.toBeUndefined();
  });
});
