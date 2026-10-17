import { describe, expect, it } from "vitest";
import {
  buildWorkspaceIndex,
  emptyWorkspaceIndex,
  type IndexedWorkspace,
} from "./workspace-index";

const WS: IndexedWorkspace[] = [
  {
    id: "ws1",
    name: "Alpha",
    editors: [
      { id: "e1", filePath: "/a/one.ts", title: "one.ts" },
      { id: "e2", filePath: null, title: "Untitled-1" },
    ],
    terminals: [{ id: "t1", title: "zsh" }],
    panels: [
      { id: "rec-1", panelId: "silo.web-viewer:rec-1", kindId: "silo.web-viewer" },
      { id: "rec-2", panelId: "silo.chat:rec-2", kindId: "silo.chat" },
    ],
  },
  {
    id: "ws2",
    name: "Beta",
    editors: [{ id: "e9", filePath: "/b/nine.ts", title: "nine.ts" }],
    terminals: [{ id: "t9", title: "bash" }],
    // A workspace whose kinds never opted into recorded persistence has no
    // `panels` at all — the field is optional on the slice we read.
  },
];

describe("findWorkspaceFor", () => {
  const index = buildWorkspaceIndex(WS);

  it("finds the owner of an editor, a terminal, and a panel record", () => {
    expect(index.findWorkspaceFor("editor", "e1")).toBe("ws1");
    expect(index.findWorkspaceFor("terminal", "t9")).toBe("ws2");
    expect(index.findWorkspaceFor("panel", "rec-2")).toBe("ws1");
  });

  it("is undefined for an id that doesn't exist", () => {
    expect(index.findWorkspaceFor("editor", "nope")).toBeUndefined();
    expect(index.findWorkspaceFor("panel", "nope")).toBeUndefined();
  });

  it("keeps the kinds in separate namespaces", () => {
    // An editor id and a terminal id could collide; they must not resolve
    // through each other's map.
    const index2 = buildWorkspaceIndex([
      { id: "a", name: "A", editors: [{ id: "x", filePath: null, title: "x" }], terminals: [] },
      { id: "b", name: "B", editors: [], terminals: [{ id: "x", title: "x" }] },
    ]);
    expect(index2.findWorkspaceFor("editor", "x")).toBe("a");
    expect(index2.findWorkspaceFor("terminal", "x")).toBe("b");
  });

  it("looks a panel up by its *record* id, never its panelId", () => {
    expect(index.findWorkspaceFor("panel", "silo.chat:rec-2")).toBeUndefined();
  });
});

describe("the panelId bridge", () => {
  const index = buildWorkspaceIndex(WS);

  it("resolves a live panelId to its workspace and persisted record id", () => {
    expect(index.panelLocation("silo.chat:rec-2")).toEqual({
      workspaceId: "ws1",
      recordId: "rec-2",
    });
  });

  it("is null for a panel with no record — nothing stable to key a mark on", () => {
    expect(index.panelLocation("silo.picker:transient")).toBeNull();
  });

  it("keeps panelIds distinct across workspaces", () => {
    const index2 = buildWorkspaceIndex([
      {
        id: "a",
        name: "A",
        editors: [],
        terminals: [],
        panels: [{ id: "rec", panelId: "k:1", kindId: "k" }],
      },
      {
        id: "b",
        name: "B",
        editors: [],
        terminals: [],
        panels: [{ id: "rec", panelId: "k:2", kindId: "k" }],
      },
    ]);
    expect(index2.panelLocation("k:1")).toEqual({
      workspaceId: "a",
      recordId: "rec",
    });
    expect(index2.panelLocation("k:2")).toEqual({
      workspaceId: "b",
      recordId: "rec",
    });
  });
});

describe("liveIds", () => {
  const index = buildWorkspaceIndex(WS);

  it("reports a workspace's tabs in persisted-key form", () => {
    const live = index.liveIds("ws1");
    expect([...live.editors].sort()).toEqual(["e1", "e2"]);
    expect([...live.terminals]).toEqual(["t1"]);
    // Record ids, *not* panelIds — this is what the pruner compares against.
    expect([...live.panels].sort()).toEqual(["rec-1", "rec-2"]);
  });

  it("is empty for a workspace with no recorded panels", () => {
    expect(index.liveIds("ws2").panels.size).toBe(0);
  });

  it("is empty — not undefined — for an unknown workspace", () => {
    const live = index.liveIds("nope");
    expect(live.editors.size).toBe(0);
    expect(live.terminals.size).toBe(0);
    expect(live.panels.size).toBe(0);
  });
});

describe("workspaceIds", () => {
  it("lists every workspace, so the pruner can drop the rest", () => {
    expect([...buildWorkspaceIndex(WS).workspaceIds()]).toEqual(["ws1", "ws2"]);
  });

  it("is empty for the pre-hydration index", () => {
    expect(emptyWorkspaceIndex().workspaceIds().size).toBe(0);
  });
});
