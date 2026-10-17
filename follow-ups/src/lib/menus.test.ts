import { describe, expect, it, vi } from "vitest";
import type { MenuEntry, MenuItem } from "@silo-code/sdk";
import { defaultLabels, reorderLabels } from "./labels";
import type { FollowUp } from "./store";
import { followUpMenu, groupMenu, type FollowUpActions } from "./menus";

const LABELS = defaultLabels();

function noopActions(): FollowUpActions {
  return {
    setLabel: vi.fn(),
    editNote: vi.fn(),
    removeNote: vi.fn(),
    clear: vi.fn(),
  };
}

const rows = (entries: MenuEntry[]): MenuItem[] =>
  entries.filter((e): e is MenuItem => !("type" in e));

const labelsOf = (entries: MenuEntry[]) => rows(entries).map((r) => r.label);

const marked = (over: Partial<FollowUp> = {}): FollowUp => ({
  labelId: "ok",
  note: "",
  markedAt: 1,
  ...over,
});

describe("followUpMenu — the label picker", () => {
  it("leads with a header and one row per label, in settings order", () => {
    const entries = followUpMenu(LABELS, null, noopActions());
    expect(entries[0]).toEqual({ type: "header", label: "Follow up with" });
    expect(labelsOf(entries).slice(0, 5)).toEqual(
      LABELS.map((l) => l.name),
    );
  });

  it("follows a reorder", () => {
    const entries = followUpMenu(
      reorderLabels(LABELS, 2, 0),
      null,
      noopActions(),
    );
    expect(labelsOf(entries)[0]).toBe("Blocked");
  });

  it("checks exactly one row — the current label", () => {
    const entries = followUpMenu(LABELS, marked({ labelId: "error" }), noopActions());
    const checked = rows(entries).filter((r) => r.checked);
    expect(checked).toHaveLength(1);
    expect(checked[0].label).toBe("Blocked");
  });

  it("checks nothing when the tab isn't marked — there is no current label", () => {
    const entries = followUpMenu(LABELS, null, noopActions());
    expect(rows(entries).filter((r) => r.checked)).toHaveLength(0);
  });

  it("runs setLabel with the row's own id", () => {
    const actions = noopActions();
    const entries = followUpMenu(LABELS, null, actions);
    rows(entries)[2].run!();
    expect(actions.setLabel).toHaveBeenCalledWith("error");
  });

  it("takes its swatch from the injected factory, so the builder stays React-free", () => {
    const swatch = vi.fn((id: string) => `dot:${id}` as unknown as MenuItem["icon"]);
    const entries = followUpMenu(LABELS, null, noopActions(), swatch);
    expect(rows(entries)[0].icon).toBe("dot:warn");
    expect(swatch).toHaveBeenCalledTimes(5);
  });

  it("leaves icons undefined when no factory is supplied", () => {
    const entries = followUpMenu(LABELS, null, noopActions());
    expect(rows(entries)[0].icon).toBeUndefined();
  });
});

describe("followUpMenu — the note rows", () => {
  it("offers nothing to note on an unmarked tab", () => {
    const entries = followUpMenu(LABELS, null, noopActions());
    expect(labelsOf(entries)).not.toContain("Add note…");
    expect(labelsOf(entries)).not.toContain("Edit note…");
    expect(labelsOf(entries)).not.toContain("Remove note");
  });

  it('says "Add note…" when marked with no note', () => {
    const entries = followUpMenu(LABELS, marked({ note: "" }), noopActions());
    expect(labelsOf(entries)).toContain("Add note…");
    expect(labelsOf(entries)).not.toContain("Edit note…");
    expect(labelsOf(entries)).not.toContain("Remove note");
  });

  it('flips to "Edit note…" and offers removal once there is a note', () => {
    const entries = followUpMenu(LABELS, marked({ note: "why" }), noopActions());
    expect(labelsOf(entries)).toContain("Edit note…");
    expect(labelsOf(entries)).not.toContain("Add note…");
    expect(labelsOf(entries)).toContain("Remove note");
  });

  it("wires both note rows to their actions", () => {
    const actions = noopActions();
    const entries = followUpMenu(LABELS, marked({ note: "why" }), actions);
    rows(entries).find((r) => r.label === "Edit note…")!.run!();
    rows(entries).find((r) => r.label === "Remove note")!.run!();
    expect(actions.editNote).toHaveBeenCalledOnce();
    expect(actions.removeNote).toHaveBeenCalledOnce();
  });
});

describe("followUpMenu — clear", () => {
  it("is disabled, not hidden, when the tab isn't marked", () => {
    const entries = followUpMenu(LABELS, null, noopActions());
    const clear = rows(entries).find((r) => r.label === "Clear follow-up")!;
    expect(clear.disabled).toBe(true);
  });

  it("is enabled and wired once the tab is marked", () => {
    const actions = noopActions();
    const entries = followUpMenu(LABELS, marked(), actions);
    const clear = rows(entries).find((r) => r.label === "Clear follow-up")!;
    expect(clear.disabled).toBe(false);
    clear.run!();
    expect(actions.clear).toHaveBeenCalledOnce();
  });

  it("is the last row", () => {
    const names = labelsOf(followUpMenu(LABELS, marked({ note: "why" }), noopActions()));
    expect(names[names.length - 1]).toBe("Clear follow-up");
  });
});

describe("groupMenu", () => {
  it("offers all three groupings under a header, with the current one checked", () => {
    const apply = vi.fn();
    const entries = groupMenu("label", apply);
    expect(entries[0]).toEqual({ type: "header", label: "Group by" });
    expect(labelsOf(entries)).toEqual(["None", "Workspace", "Label"]);
    const checked = rows(entries).filter((r) => r.checked);
    expect(checked).toHaveLength(1);
    expect(checked[0].label).toBe("Label");
  });

  it("applies the picked grouping", () => {
    const apply = vi.fn();
    rows(groupMenu("none", apply))[1].run!();
    expect(apply).toHaveBeenCalledWith("workspace");
  });
});
