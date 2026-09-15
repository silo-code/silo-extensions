import { describe, expect, it } from "vitest";
import { resolveTarget, type ActiveTab } from "./target";
import type { PanelKind } from "./store";

// Every id in these tests belongs to "ws1", except the explicitly unknown ones.
const workspaceFor = (_kind: PanelKind, id: string): string | undefined =>
  id.startsWith("orphan") ? undefined : "ws1";

const NO_ACTIVE: ActiveTab = { editorId: null, terminalId: null };

describe("resolveTarget — from the invoking surface", () => {
  it("takes the editor a toolbar button / tab menu names", () => {
    expect(
      resolveTarget([{ editorId: "e1" }], NO_ACTIVE, workspaceFor),
    ).toEqual({ kind: "editor", id: "e1", workspaceId: "ws1" });
  });

  it("takes the terminal, preferring the workspace the surface carries", () => {
    expect(
      resolveTarget(
        [{ terminalId: "t1", workspaceId: "ws-other" }],
        NO_ACTIVE,
        workspaceFor,
      ),
    ).toEqual({ kind: "terminal", id: "t1", workspaceId: "ws-other" });
  });

  it("looks the workspace up when the surface omits it", () => {
    expect(
      resolveTarget([{ terminalId: "t1" }], NO_ACTIVE, workspaceFor),
    ).toEqual({ kind: "terminal", id: "t1", workspaceId: "ws1" });
  });

  it("takes the terminal from the RFC 0039 panel toolbar target", () => {
    expect(
      resolveTarget(
        [
          {
            panelId: "terminal:t1",
            kindId: "terminal",
            workspaceId: "ws1",
            params: { terminalId: "t1" },
          },
        ],
        NO_ACTIVE,
        workspaceFor,
      ),
    ).toEqual({ kind: "terminal", id: "t1", workspaceId: "ws1" });
  });

  it("takes a dock panel from the RFC 0039 panel toolbar target", () => {
    expect(
      resolveTarget(
        [
          {
            panelId: "silo.agents-chat-panel:p1",
            kindId: "silo.agents-chat-panel",
            workspaceId: "ws1",
            params: {},
          },
        ],
        NO_ACTIVE,
        workspaceFor,
      ),
    ).toEqual({
      kind: "panel",
      id: "silo.agents-chat-panel:p1",
      workspaceId: "ws1",
    });
  });

  it("is null for a terminal toolbar target missing its own terminalId", () => {
    expect(
      resolveTarget(
        [
          {
            panelId: "terminal:t1",
            kindId: "terminal",
            workspaceId: "ws1",
            params: {},
          },
        ],
        NO_ACTIVE,
        workspaceFor,
      ),
    ).toBeNull();
  });

  it("takes a dock panel from the RFC 0046 panel/tab menu target, workspace included", () => {
    expect(
      resolveTarget(
        [
          {
            panelId: "silo.docs-panel:p1",
            kindId: "silo.docs-panel",
            workspaceId: "ws-other",
            params: {},
          },
        ],
        NO_ACTIVE,
        workspaceFor,
      ),
    ).toEqual({
      kind: "panel",
      id: "silo.docs-panel:p1",
      workspaceId: "ws-other",
    });
  });

  it("wins over the active tab", () => {
    const active: ActiveTab = { editorId: "e-active", terminalId: null };
    expect(resolveTarget([{ editorId: "e1" }], active, workspaceFor)).toEqual({
      kind: "editor",
      id: "e1",
      workspaceId: "ws1",
    });
  });

  it("is null for a tab whose workspace is gone", () => {
    expect(
      resolveTarget([{ editorId: "orphan1" }], NO_ACTIVE, workspaceFor),
    ).toBeNull();
  });
});

describe("resolveTarget — from the active tab (keybinding invocation)", () => {
  // A keybinding runs the command with NO arguments, so this fallback is the
  // only thing that gives it a tab to act on.
  it("falls back to the active editor", () => {
    const active: ActiveTab = { editorId: "e9", terminalId: null };
    expect(resolveTarget([], active, workspaceFor)).toEqual({
      kind: "editor",
      id: "e9",
      workspaceId: "ws1",
    });
  });

  it("falls back to the active terminal", () => {
    const active: ActiveTab = { editorId: null, terminalId: "t9" };
    expect(resolveTarget([], active, workspaceFor)).toEqual({
      kind: "terminal",
      id: "t9",
      workspaceId: "ws1",
    });
  });

  it("is null when no tab is active", () => {
    expect(resolveTarget([], NO_ACTIVE, workspaceFor)).toBeNull();
  });

  it("ignores a non-object first argument", () => {
    const active: ActiveTab = { editorId: "e9", terminalId: null };
    for (const arg of [undefined, null, "e1", 42]) {
      expect(resolveTarget([arg], active, workspaceFor)).toEqual({
        kind: "editor",
        id: "e9",
        workspaceId: "ws1",
      });
    }
  });

  it("is null when the active tab's workspace is gone", () => {
    const active: ActiveTab = { editorId: "orphan9", terminalId: null };
    expect(resolveTarget([], active, workspaceFor)).toBeNull();
  });
});
