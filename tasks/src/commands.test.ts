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
  const logError = vi.fn();
  // A sheet that stays open until the test closes it, mirroring
  // `openPanelSheet`'s promise settling only when the sheet is dismissed.
  let closeSheet: (() => void) | undefined;
  const openSheet = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        closeSheet = resolve;
      }),
  );
  const sheetBridge = createPanelBridge();
  const commands = createCommands({
    sourceSet,
    bridge,
    sheetBridge,
    revealPanel,
    notify,
    logError,
    openSheet,
  });
  return {
    ...h,
    sourceSet,
    bridge,
    sheetBridge,
    commands,
    revealPanel,
    notify,
    logError,
    openSheet,
    closeSheet: () => closeSheet?.(),
  };
}

describe("createCommands", () => {
  it("newInWorkspace with a title creates and returns the task", async () => {
    const { commands, sourceSet } = await harness();
    const task = await commands.newInWorkspace("Write the RFC");
    expect(task?.title).toBe("Write the RFC");
    expect(sourceSet.getState().sources).toHaveLength(1);
  });

  it("newInWorkspace targets the workspace source when a workspace is open", async () => {
    const { commands, sourceSet, workspaces } = await harness({
      globalDir: "/cfg/g",
      workspaceDirs: { w1: "/cfg/ws/w1" },
    });
    workspaces.setAll([{ id: "w1", name: "Repo", folder: "/r" }] as never);
    workspaces.setActive("w1");
    await new Promise((r) => setTimeout(r, 0));
    const task = await commands.newInWorkspace("In the repo");
    const wsSource = sourceSet.getState().sources.find((s) => s.scope === "workspace");
    expect(task?.sourceId).toBe(wsSource?.id);
  });

  it("newInWorkspace with no title reveals the panel and resolves undefined", async () => {
    const { commands, revealPanel, bridge } = await harness();
    const focus = vi.fn();
    bridge.focusQuickAdd = focus;
    await expect(commands.newInWorkspace()).resolves.toBeUndefined();
    expect(revealPanel).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
  });

  it("newInWorkspace falls back to the global list when no workspace is open", async () => {
    const { commands, sourceSet } = await harness();
    const task = await commands.newInWorkspace("Personal note");
    const global = sourceSet.getState().sources.find((s) => s.scope === "global");
    expect(task?.sourceId).toBe(global?.id);
  });

  it("refresh always resolves", async () => {
    const { commands } = await harness();
    await expect(commands.refresh()).resolves.toBeUndefined();
  });
});

describe("openApp — the Tasks app sheet", () => {
  it("opens the sheet once and re-reveals instead of stacking a second", async () => {
    const { commands, openSheet, revealPanel } = await harness();
    commands.openApp();
    expect(openSheet).toHaveBeenCalledTimes(1);

    commands.openApp();
    expect(openSheet).toHaveBeenCalledTimes(1);
    expect(revealPanel).toHaveBeenCalledTimes(1);
  });

  it("opens again after the sheet is closed", async () => {
    const { commands, openSheet, closeSheet } = await harness();
    commands.openApp();
    closeSheet();
    await new Promise((r) => setTimeout(r, 0));

    commands.openApp();
    expect(openSheet).toHaveBeenCalledTimes(2);
  });

  it("opens with no workspace open — the global list is always there", async () => {
    const { commands, openSheet, sourceSet } = await harness();
    expect(sourceSet.getState().sources).toHaveLength(1);
    commands.openApp();
    expect(openSheet).toHaveBeenCalledTimes(1);
  });

  it("reports a failed open and clears the guard so a retry works", async () => {
    const h = await harness();
    h.openSheet.mockRejectedValueOnce(new Error("no such panel"));
    h.commands.openApp();
    await new Promise((r) => setTimeout(r, 0));

    expect(h.logError).toHaveBeenCalled();
    expect(h.notify).toHaveBeenCalledWith(
      "error",
      expect.stringMatching(/no such panel/),
    );
    h.commands.openApp();
    expect(h.openSheet).toHaveBeenCalledTimes(2);
  });
});

describe("openApp — opening the sheet for one task", () => {
  it("passes the task through so the sheet lands on its detail page", async () => {
    const { commands, openSheet } = await harness();
    commands.openApp({ sourceId: "s1", taskId: "t1" });
    expect(openSheet).toHaveBeenCalledWith(
      { sourceId: "s1", taskId: "t1" },
      undefined,
      undefined,
    );
  });

  it("re-points an already open sheet instead of stacking a second", async () => {
    const { commands, openSheet, sheetBridge } = await harness();
    const drillTo = vi.fn();
    commands.openApp({ sourceId: "s1", taskId: "t1" });
    sheetBridge.drillTo = drillTo; // the sheet mounts and claims the bridge

    commands.openApp({ sourceId: "s2", taskId: "t2" });
    expect(openSheet).toHaveBeenCalledTimes(1);
    expect(drillTo).toHaveBeenCalledWith("s2", "t2");
  });

  it("re-reveals without re-pointing when opened with no task", async () => {
    const { commands, sheetBridge, revealPanel } = await harness();
    const drillTo = vi.fn();
    commands.openApp({ sourceId: "s1", taskId: "t1" });
    sheetBridge.drillTo = drillTo;

    commands.openApp();
    expect(revealPanel).toHaveBeenCalledTimes(1);
    expect(drillTo).not.toHaveBeenCalled();
  });
});

describe("openApp — the Navigator's 'New task' / 'Manage tasks' buttons", () => {
  it("opens the sheet asking for the composer to be focused", async () => {
    const { commands, openSheet } = await harness();
    commands.openApp(undefined, "nav", { focusComposer: true });
    expect(openSheet).toHaveBeenCalledWith(undefined, "nav", {
      focusComposer: true,
    });
  });

  it("opens the sheet asking for search to be focused", async () => {
    const { commands, openSheet } = await harness();
    commands.openApp(undefined, "nav", { focusSearch: true });
    expect(openSheet).toHaveBeenCalledWith(undefined, "nav", {
      focusSearch: true,
    });
  });

  it("focuses the composer on an already open sheet instead of reopening", async () => {
    const { commands, openSheet, sheetBridge, revealPanel } = await harness();
    const focusComposer = vi.fn();
    commands.openApp();
    sheetBridge.focusComposer = focusComposer; // the sheet mounts and claims it

    commands.openApp(undefined, "nav", { focusComposer: true });
    expect(openSheet).toHaveBeenCalledTimes(1);
    expect(revealPanel).toHaveBeenCalledTimes(1);
    expect(focusComposer).toHaveBeenCalledTimes(1);
  });

  it("focuses search on an already open sheet instead of reopening", async () => {
    const { commands, openSheet, sheetBridge } = await harness();
    const focusSearch = vi.fn();
    commands.openApp();
    sheetBridge.focusSearch = focusSearch;

    commands.openApp(undefined, "nav", { focusSearch: true });
    expect(openSheet).toHaveBeenCalledTimes(1);
    expect(focusSearch).toHaveBeenCalledTimes(1);
  });
});

describe("openApp — which dock column the sheet grows out of", () => {
  it("anchors to the panel the click came from", async () => {
    const { commands, openSheet } = await harness();
    commands.openApp({ sourceId: "s1", taskId: "t1" }, "navigator");
    expect(openSheet).toHaveBeenCalledWith(
      { sourceId: "s1", taskId: "t1" },
      "navigator",
      undefined,
    );
  });

  it("passes no anchor when opened from the palette, so the host picks the default", async () => {
    const { commands, openSheet } = await harness();
    commands.openApp();
    expect(openSheet).toHaveBeenCalledWith(undefined, undefined, undefined);
  });

  it("anchors to the Navigator column with no task — the 'Manage tasks' button", async () => {
    const { commands, openSheet } = await harness();
    commands.openApp(undefined, "silo.navigator.left");
    expect(openSheet).toHaveBeenCalledWith(
      undefined,
      "silo.navigator.left",
      undefined,
    );
  });
});
