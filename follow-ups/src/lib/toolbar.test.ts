import { describe, expect, it, vi } from "vitest";
import type { ContextKeys, MenuEntry, ToolbarItemContext } from "@silo-code/sdk";
import {
  EDITOR_ITEM_ID,
  PANEL_ITEM_ID,
  TOGGLE_COMMAND,
  buildToolbarItems,
  type ToolbarDeps,
} from "./toolbar";

const EDITOR: ToolbarItemContext["editor"] = { editorId: "e1" };

const PANEL: ToolbarItemContext["panel"] = {
  panelId: "p1",
  kindId: "terminal",
  workspaceId: "w1",
  params: {},
};

// `when` / `checked` take the host's context keys first; nothing here reads
// them, so one empty stand-in serves every call.
const KEYS = {} as ContextKeys;

const MENU: MenuEntry[] = [{ label: "Blocked", run: () => {} }];

function deps(over: Partial<ToolbarDeps> = {}): ToolbarDeps {
  return {
    tooltip: "Mark as follow-up: Blocked",
    editorMarked: vi.fn(() => false),
    editorMenu: vi.fn(() => MENU),
    panelAvailable: vi.fn(() => true),
    panelMarked: vi.fn(() => false),
    panelMenu: vi.fn(() => MENU),
    ...over,
  };
}

const ids = (items: readonly { id: string }[]) => items.map((i) => i.id);

describe("buildToolbarItems", () => {
  it("contributes exactly one welded item per surface", () => {
    const built = buildToolbarItems(deps());
    expect(ids(built.editor)).toEqual([EDITOR_ITEM_ID]);
    expect(ids(built.panel)).toEqual([PANEL_ITEM_ID]);
    expect(built.editor.every((i) => i.dropdown !== undefined)).toBe(true);
    expect(built.panel.every((i) => i.dropdown !== undefined)).toBe(true);
  });

  it("keeps the command on the left half", () => {
    const [editor] = buildToolbarItems(deps()).editor;
    expect(editor).toMatchObject({
      command: TOGGLE_COMMAND,
      icon: "Flag",
      tooltip: "Mark as follow-up: Blocked",
    });
  });

  it("puts the live tooltip on the command half", () => {
    const tooltip = "Mark as follow-up: Read later";
    expect(buildToolbarItems(deps({ tooltip })).editor[0].tooltip).toBe(
      tooltip,
    );
  });

  it("hangs the label picker off the caret", async () => {
    const d = deps();
    const built = buildToolbarItems(d);
    const [editor] = built.editor;
    const [panel] = built.panel;

    expect(await editor.dropdown?.menu(EDITOR)).toEqual(MENU);
    expect(d.editorMenu).toHaveBeenCalledWith(EDITOR);
    expect(await panel.dropdown?.menu(PANEL)).toEqual(MENU);
    expect(d.panelMenu).toHaveBeenCalledWith(PANEL);
  });

  it("names the two halves separately", () => {
    const [editor] = buildToolbarItems(deps()).editor;
    expect(editor.label).toBe("Follow-up");
    expect(editor.dropdown?.label).toBe("Follow-up options");
  });

  it("carries one visibility and one checked state for the whole control", () => {
    const panelAvailable = vi.fn(() => false);
    const panelMarked = vi.fn(() => true);
    const [panel] = buildToolbarItems(
      deps({ panelAvailable, panelMarked }),
    ).panel;

    expect(panel.when?.(KEYS, PANEL)).toBe(false);
    expect(panel.checked?.(KEYS, PANEL)).toBe(true);
    expect(panelAvailable).toHaveBeenCalledWith(PANEL);
    expect(panelMarked).toHaveBeenCalledWith(PANEL);
  });
});
