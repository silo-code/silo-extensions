import { describe, expect, it, vi } from "vitest";
import type { TaskSource } from "../model/source";
import { DEFAULT_VIEW_PREFS, type ViewPrefs } from "./view";
import { sourceFilterMenu, sourcesFilterMenu, viewMenu } from "./menus";

const prefs = (over: Partial<ViewPrefs> = {}): ViewPrefs => ({
  ...DEFAULT_VIEW_PREFS,
  ...over,
});

type Labelled = { label: string; checked?: boolean; run?: () => void };
type Parent = Labelled & { submenu: Labelled[] };

function byLabel(menu: readonly unknown[], label: string): Labelled | undefined {
  return (menu as Labelled[]).find(
    (e) => e && typeof e === "object" && "label" in e && e.label === label,
  );
}

const globalSrc: TaskSource = {
  id: "s-global",
  providerId: "silo",
  locator: "/g/tasks.jsonl",
  scope: "global",
  name: "",
};
const wsSrc: TaskSource = {
  id: "s-ws",
  providerId: "silo",
  locator: "/w/tasks.jsonl",
  scope: "workspace",
  workspaceId: "ws1",
  name: "Repo",
};

describe("sourceFilterMenu — single-select, not checkable", () => {
  it("offers 'All', a header, then one entry per source", () => {
    const menu = sourceFilterMenu([globalSrc, wsSrc], vi.fn());
    expect(menu.map((e) => ("label" in e ? e.label : `<${e.type}>`))).toEqual([
      "All",
      "List",
      "No list",
      "Repo",
    ]);
  });

  it("no entry carries a checked state", () => {
    const menu = sourceFilterMenu([globalSrc, wsSrc], vi.fn());
    for (const entry of menu) {
      expect("checked" in entry && entry.checked).toBeFalsy();
    }
  });

  it("'All' clears the filter; a source entry scopes to exactly that id", () => {
    const apply = vi.fn();
    const menu = sourceFilterMenu([globalSrc, wsSrc], apply);
    const run = (label: string) => {
      const entry = menu.find((e) => "label" in e && e.label === label);
      if (entry && "run" in entry) entry.run?.();
    };

    run("All");
    expect(apply).toHaveBeenLastCalledWith({ sourceFilter: [] });

    run("Repo");
    expect(apply).toHaveBeenLastCalledWith({ sourceFilter: ["s-ws"] });

    run("No list");
    expect(apply).toHaveBeenLastCalledWith({ sourceFilter: ["s-global"] });
  });
});

describe("sourcesFilterMenu — multi-select, checkable", () => {
  it("'All lists' is checked when nothing is filtered", () => {
    const menu = sourcesFilterMenu([globalSrc, wsSrc], prefs(), vi.fn());
    expect(byLabel(menu, "All lists")?.checked).toBe(true);
    expect(byLabel(menu, "Repo")?.checked).toBe(false);
  });

  it("toggling a list adds it, toggling again removes it, order follows sources", () => {
    const apply = vi.fn();
    let cur = prefs();
    const rebuild = () => sourcesFilterMenu([globalSrc, wsSrc], cur, apply);

    byLabel(rebuild(), "Repo")?.run?.();
    expect(apply).toHaveBeenLastCalledWith({ sourceFilter: ["s-ws"] });

    cur = prefs({ sourceFilter: ["s-ws"] });
    byLabel(rebuild(), "No list")?.run?.();
    expect(apply).toHaveBeenLastCalledWith({
      sourceFilter: ["s-global", "s-ws"],
    });

    cur = prefs({ sourceFilter: ["s-global", "s-ws"] });
    byLabel(rebuild(), "Repo")?.run?.();
    expect(apply).toHaveBeenLastCalledWith({ sourceFilter: ["s-global"] });
  });

  it("'All lists' clears an active filter", () => {
    const apply = vi.fn();
    const menu = sourcesFilterMenu(
      [globalSrc, wsSrc],
      prefs({ sourceFilter: ["s-ws"] }),
      apply,
    );
    byLabel(menu, "All lists")?.run?.();
    expect(apply).toHaveBeenLastCalledWith({ sourceFilter: [] });
  });
});

describe("viewMenu — the Navigator's one 'View options' dropdown", () => {
  it("has Group by / Sort by / Filter by status / List as submenu parents", () => {
    const menu = viewMenu(prefs(), [], [globalSrc, wsSrc], vi.fn());
    const parents = (menu as Parent[])
      .filter((e) => Array.isArray(e.submenu))
      .map((e) => e.label);
    expect(parents).toEqual([
      "Group by",
      "Sort by",
      "Filter by status",
      "List",
    ]);
  });

  it("adds a 'Filter by label' submenu only when a label exists", () => {
    const without = viewMenu(prefs(), [], [globalSrc], vi.fn());
    expect(byLabel(without, "Filter by label")).toBeUndefined();

    const withLabel = viewMenu(prefs(), ["ui"], [globalSrc], vi.fn());
    expect(byLabel(withLabel, "Filter by label")).toBeDefined();
  });

  it("the List submenu is the multi-select builder", () => {
    const menu = viewMenu(
      prefs({ sourceFilter: ["s-ws"] }),
      [],
      [globalSrc, wsSrc],
      vi.fn(),
    );
    const list = byLabel(menu, "List") as Parent;
    expect(byLabel(list.submenu, "Repo")?.checked).toBe(true);
  });
});
