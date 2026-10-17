import { describe, expect, it } from "vitest";
import { isCurrent, NO_ACTIVE_TAB, type ActiveTabRef } from "./active-tab";
import type { FollowUpItem } from "./view";

function item(over: Partial<FollowUpItem> = {}): FollowUpItem {
  return {
    workspaceId: "ws1",
    workspaceName: "Alpha",
    kind: "editor",
    id: "e1",
    targetId: "e1",
    filePath: "/a/one.ts",
    title: "one.ts",
    labelId: "warn",
    note: "",
    markedAt: 0,
    ...over,
  };
}

const active: ActiveTabRef = {
  workspaceId: "ws1",
  editorId: "e1",
  terminalId: null,
  panelRecordId: null,
};

describe("isCurrent", () => {
  it("marks the active editor in the active workspace", () => {
    expect(isCurrent(item(), active)).toBe(true);
  });

  it("marks the active terminal", () => {
    const t: ActiveTabRef = {
      workspaceId: "ws1",
      editorId: null,
      terminalId: "t1",
      panelRecordId: null,
    };
    expect(isCurrent(item({ kind: "terminal", id: "t1" }), t)).toBe(true);
  });

  it("is false for another tab in the same workspace", () => {
    expect(isCurrent(item({ id: "e2" }), active)).toBe(false);
  });

  it("is false for the same id in a different workspace", () => {
    // There is one active tab in the app, not one per workspace — a row in a
    // background workspace is never current, however its id compares.
    expect(isCurrent(item({ workspaceId: "ws2" }), active)).toBe(false);
  });

  it("does not cross the editor/terminal id namespaces", () => {
    expect(isCurrent(item({ kind: "terminal", id: "e1" }), active)).toBe(false);
  });

  it("marks the active dock panel, by record id (RFC 0064)", () => {
    const p: ActiveTabRef = {
      workspaceId: "ws1",
      editorId: null,
      terminalId: null,
      panelRecordId: "rec-1",
    };
    expect(isCurrent(item({ kind: "panel", id: "rec-1" }), p)).toBe(true);
    expect(isCurrent(item({ kind: "panel", id: "rec-2" }), p)).toBe(false);
  });

  it("never infers a panel from the absence of an editor and a terminal", () => {
    // Guessing would light up every flagged panel row in the workspace at
    // once.
    const nothingElse: ActiveTabRef = {
      workspaceId: "ws1",
      editorId: null,
      terminalId: null,
      panelRecordId: null,
    };
    expect(isCurrent(item({ kind: "panel", id: "rec-1" }), nothingElse)).toBe(
      false,
    );
  });

  it("does not let a panel record id match an editor or terminal row", () => {
    const p: ActiveTabRef = {
      workspaceId: "ws1",
      editorId: null,
      terminalId: null,
      panelRecordId: "shared-id",
    };
    expect(isCurrent(item({ kind: "editor", id: "shared-id" }), p)).toBe(false);
    expect(isCurrent(item({ kind: "terminal", id: "shared-id" }), p)).toBe(false);
    expect(isCurrent(item({ kind: "panel", id: "shared-id" }), p)).toBe(true);
  });

  it("is false when nothing at all is active", () => {
    expect(isCurrent(item(), NO_ACTIVE_TAB)).toBe(false);
  });

  it("is false when no workspace is active, whatever the tab ids say", () => {
    expect(
      isCurrent(item(), {
        workspaceId: null,
        editorId: "e1",
        terminalId: null,
        panelRecordId: null,
      }),
    ).toBe(false);
  });
});
