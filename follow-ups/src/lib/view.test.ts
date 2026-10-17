import { describe, expect, it } from "vitest";
import { coerceLabels, defaultLabels, reorderLabels } from "./labels";
import { parseMarks, setFollowUp, type MarksState } from "./store";
import type { IndexedWorkspace } from "./workspace-index";
import {
  buildFollowUpView,
  collectItems,
  countByLabel,
  itemKey,
  panelTitle,
  sortItems,
  type FollowUpItem,
} from "./view";

const T0 = 1_700_000_000_000;
const LABELS = defaultLabels();

const WS: IndexedWorkspace[] = [
  {
    id: "ws1",
    name: "Alpha",
    editors: [
      { id: "e1", filePath: "/a/one.ts", title: "one.ts" },
      { id: "e2", filePath: null, title: "Untitled-1" },
      { id: "e3", filePath: "/a/dead.ts", title: "dead.ts" },
    ],
    terminals: [{ id: "t1", title: "zsh", customName: "build" }],
    panels: [
      { id: "rec-1", panelId: "silo.chat:rec-1", kindId: "silo.chat" },
      {
        id: "rec-2",
        panelId: "silo.web-viewer:rec-2",
        kindId: "silo.web-viewer",
        customTitle: "Docs",
      },
      {
        id: "rec-3",
        panelId: "silo.agents-chat-panel:rec-3",
        kindId: "silo.agents-chat-panel",
        state: { title: "Generic types file editing" },
      },
    ],
  },
  {
    id: "ws2",
    name: "Beta",
    editors: [{ id: "e9", filePath: "/b/nine.ts", title: "nine.ts" }],
    terminals: [{ id: "t9", title: "bash" }],
  },
];

function marksFixture(): MarksState {
  const s: MarksState = new Map();
  setFollowUp(s, "ws1", "editor", "e1", { labelId: "warn", note: "ask Ana" }, T0 + 300);
  setFollowUp(s, "ws1", "editor", "e2", { labelId: "ok" }, T0 + 200);
  setFollowUp(s, "ws1", "terminal", "t1", { labelId: "error" }, T0 + 400);
  setFollowUp(s, "ws1", "panel", "rec-2", { labelId: "warn" }, T0 + 100);
  setFollowUp(s, "ws2", "editor", "e9", { labelId: "ok" }, T0 + 500);
  // A mark on a tab that no longer exists — must never surface as a row.
  setFollowUp(s, "ws1", "editor", "ghost", { labelId: "warn" }, T0 + 900);
  return s;
}

const byId = (items: readonly FollowUpItem[]) => items.map((i) => i.id);

describe("collectItems", () => {
  const items = collectItems(WS, marksFixture());

  it("emits one item per live marked tab and excludes dead ids", () => {
    expect(byId(items)).toEqual(["e9", "t1", "e1", "e2", "rec-2"]);
  });

  it("leaves an unmarked tab out entirely", () => {
    expect(items.some((i) => i.id === "e3")).toBe(false);
    expect(items.some((i) => i.id === "rec-1")).toBe(false);
  });

  it("carries the label, the note, and the workspace name", () => {
    const e1 = items.find((i) => i.id === "e1")!;
    expect(e1).toMatchObject({
      workspaceId: "ws1",
      workspaceName: "Alpha",
      kind: "editor",
      labelId: "warn",
      note: "ask Ana",
      filePath: "/a/one.ts",
    });
  });

  it("titles a terminal by its user-assigned name when it has one", () => {
    expect(items.find((i) => i.id === "t1")!.title).toBe("build");
    const plain = collectItems(
      WS,
      (() => {
        const s: MarksState = new Map();
        setFollowUp(s, "ws2", "terminal", "t9", { labelId: "warn" }, T0);
        return s;
      })(),
    );
    expect(plain[0].title).toBe("bash");
  });

  it("titles a panel by its customTitle, falling back to the kind id", () => {
    expect(items.find((i) => i.id === "rec-2")!.title).toBe("Docs");
    const chat = collectItems(
      WS,
      (() => {
        const s: MarksState = new Map();
        setFollowUp(s, "ws1", "panel", "rec-1", { labelId: "warn" }, T0);
        setFollowUp(s, "ws1", "panel", "rec-3", { labelId: "warn" }, T0 + 1);
        return s;
      })(),
    );
    // No customTitle and no state.title — the prettified kind id is all there is.
    expect(chat.find((i) => i.id === "rec-1")!.title).toBe("Chat");
    // state.title is where a panel that calls `setTitle` keeps its live title.
    expect(chat.find((i) => i.id === "rec-3")!.title).toBe(
      "Generic types file editing",
    );
  });

  it("points a panel's reveal at the live panelId, not the record id", () => {
    const panel = items.find((i) => i.id === "rec-2")!;
    expect(panel.targetId).toBe("silo.web-viewer:rec-2");
  });

  it("carries the file path, which is what the row's tooltip names", () => {
    expect(items.find((i) => i.id === "e1")!.filePath).toBe("/a/one.ts");
    expect(items.find((i) => i.id === "e2")!.filePath).toBeNull();
    expect(items.find((i) => i.id === "t1")!.filePath).toBeNull();
  });

  it("gives every row a key unique across workspaces and kinds", () => {
    const keys = items.map(itemKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("sortItems", () => {
  it("is most-recent first, with unknown (0) times last", () => {
    // `t1`'s mark came through the legacy migration, so its time is unknown —
    // which is not evidence that it is the oldest.
    const s = parseMarks(
      {
        ws1: {
          editors: { e1: { label: "warn", markedAt: T0 + 20 } },
          terminals: ["t1"],
        },
        ws2: { editors: { e9: { label: "warn", markedAt: T0 + 10 } } },
      },
      "warn",
    );
    const items = collectItems(WS, s);
    expect(byId(items)).toEqual(["e1", "e9", "t1"]);
    expect(items[2].markedAt).toBe(0);
  });

  it("breaks ties on title so the order is stable", () => {
    const base = {
      workspaceId: "ws1",
      workspaceName: "Alpha",
      kind: "editor" as const,
      targetId: "x",
      filePath: null,
      labelId: "warn",
      note: "",
      markedAt: T0,
    };
    const items = sortItems([
      { ...base, id: "b", title: "beta" },
      { ...base, id: "a", title: "alpha" },
    ]);
    expect(byId(items)).toEqual(["a", "b"]);
  });
});

describe("countByLabel", () => {
  it("counts items per label id", () => {
    const by = countByLabel(collectItems(WS, marksFixture()));
    expect(by.get("warn")).toBe(2);
    expect(by.get("ok")).toBe(2);
    expect(by.get("error")).toBe(1);
    expect(by.has("muted")).toBe(false);
  });
});

describe("buildFollowUpView", () => {
  const items = collectItems(WS, marksFixture());

  it('"none" is one unlabeled group holding everything', () => {
    const groups = buildFollowUpView(items, LABELS, "none", {});
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe("");
    expect(groups[0].items).toHaveLength(items.length);
  });

  it('"workspace" groups by workspace, titled by name', () => {
    const groups = buildFollowUpView(items, LABELS, "workspace", {});
    expect(groups.map((g) => [g.key, g.title])).toEqual([
      ["ws2", "Beta"],
      ["ws1", "Alpha"],
    ]);
    expect(byId(groups[1].items)).toEqual(["t1", "e1", "e2", "rec-2"]);
  });

  it('"label" groups by label, titled by the user\'s name', () => {
    const groups = buildFollowUpView(items, LABELS, "label", {});
    expect(groups.map((g) => g.key)).toEqual(["warn", "ok", "error"]);
    expect(groups[0].title).toBe("Need more info");
  });

  it("label groups follow the settings order, not alphabetical", () => {
    // Drag `error` to the front; the view must follow.
    const reordered = reorderLabels(LABELS, 2, 0);
    const groups = buildFollowUpView(items, reordered, "label", {});
    expect(groups.map((g) => g.key)).toEqual(["error", "warn", "ok"]);
  });

  it("renames follow the settings names", () => {
    const renamed = coerceLabels([{ id: "warn", name: "Chasing" }]);
    const groups = buildFollowUpView(items, renamed, "label", {});
    expect(groups[0].title).toBe("Chasing");
  });

  it("sorts within a group, not just globally", () => {
    const groups = buildFollowUpView(items, LABELS, "label", {});
    const warn = groups.find((g) => g.key === "warn")!;
    expect(byId(warn.items)).toEqual(["e1", "rec-2"]);
  });

  it("still names the group when only one has anything in it", () => {
    // One workspace, one label — the header is exactly what the user needs to
    // see, so a chosen grouping must not quietly flatten itself.
    const s: MarksState = new Map();
    setFollowUp(s, "ws1", "editor", "e1", { labelId: "warn" }, T0);
    setFollowUp(s, "ws1", "editor", "e2", { labelId: "warn" }, T0 + 1);
    const only = collectItems(WS, s);
    expect(buildFollowUpView(only, LABELS, "workspace", {})).toMatchObject([
      { key: "ws1", title: "Alpha" },
    ]);
    expect(buildFollowUpView(only, LABELS, "label", {})).toMatchObject([
      { key: "warn", title: "Need more info" },
    ]);
  });

  it('only "none" is header-less — that is what it is for', () => {
    const s: MarksState = new Map();
    setFollowUp(s, "ws1", "editor", "e1", { labelId: "warn" }, T0);
    const groups = buildFollowUpView(collectItems(WS, s), LABELS, "none", {});
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe("");
  });

  it("is one empty unlabeled group when there is nothing at all", () => {
    const groups = buildFollowUpView([], LABELS, "workspace", {});
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toEqual([]);
  });

  it("marks a group collapsed from the persisted set", () => {
    const groups = buildFollowUpView(items, LABELS, "workspace", {
      ws1: true,
    });
    expect(groups.find((g) => g.key === "ws1")!.collapsed).toBe(true);
    expect(groups.find((g) => g.key === "ws2")!.collapsed).toBe(false);
  });

  it("never collapses the unlabeled group — it has no header to click", () => {
    const groups = buildFollowUpView(items, LABELS, "none", { all: true });
    expect(groups[0].collapsed).toBe(false);
  });

  it("buckets an unknown label id under the default rather than dropping it", () => {
    const s = parseMarks(
      { ws1: { editors: { e1: { label: "chartreuse", markedAt: T0 } } } },
      "warn",
    );
    const groups = buildFollowUpView(collectItems(WS, s), LABELS, "label", {});
    expect(groups).toHaveLength(1);
    expect(byId(groups[0].items)).toEqual(["e1"]);
  });
});

describe("panelTitle", () => {
  it("prefers the user's own rename over everything", () => {
    expect(
      panelTitle({
        kindId: "silo.agents-chat-panel",
        customTitle: "My chat",
        state: { title: "Generic types file editing" },
      }),
    ).toBe("My chat");
  });

  it("falls back to state.title — where a panel that calls setTitle keeps it", () => {
    expect(
      panelTitle({
        kindId: "agents-chat-panel",
        state: { title: "Generic types file editing" },
      }),
    ).toBe("Generic types file editing");
  });

  it("trims state.title and ignores a blank or non-string one", () => {
    expect(panelTitle({ kindId: "k", state: { title: "  Padded  " } })).toBe(
      "Padded",
    );
    for (const title of ["", "   ", 7, null, {}]) {
      expect(panelTitle({ kindId: "web-viewer", state: { title } })).toBe(
        "Web Viewer",
      );
    }
  });

  it("prettifies the kind id when there is nothing else", () => {
    expect(panelTitle({ kindId: "silo.agents-chat-panel" })).toBe(
      "Agents Chat Panel",
    );
    expect(panelTitle({ kindId: "web-viewer", state: {} })).toBe("Web Viewer");
    expect(panelTitle({ kindId: "notes" })).toBe("Notes");
  });
});
