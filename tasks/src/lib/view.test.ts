import { describe, expect, it } from "vitest";
import type { Task, TaskLane, TaskPriority } from "../model/task";
import type { TaskSource } from "../model/source";
import {
  buildView,
  DEFAULT_LANE_FILTER,
  DEFAULT_VIEW_PREFS,
  labelFilterLabel,
  laneFilterLabel,
  sourceFilterLabel,
  type ViewPrefs,
} from "./view";

let seq = 0;
function task(over: Partial<Task> = {}): Task {
  seq += 1;
  return {
    id: `t${seq}`,
    sourceId: "s-global",
    title: `Task ${seq}`,
    lane: "todo" as TaskLane,
    statusLabel: "Todo",
    priority: "normal" as TaskPriority,
    rank: String(seq).padStart(4, "0"),
    parentId: null,
    labels: [],
    assignees: [],
    updatedAt: seq,
    ...over,
  };
}

const globalSrc: TaskSource = {
  id: "s-global",
  providerId: "silo",
  locator: "/g/tasks.jsonl",
  scope: "global",
  name: "Personal",
};
const wsSrc: TaskSource = {
  id: "s-ws",
  providerId: "silo",
  locator: "/w/tasks.jsonl",
  scope: "workspace",
  workspaceId: "ws1",
  name: "Repo",
};

function prefs(over: Partial<ViewPrefs> = {}): ViewPrefs {
  return { ...DEFAULT_VIEW_PREFS, ...over };
}

describe("buildView — grouping", () => {
  it("none: one unnamed group", () => {
    const groups = buildView([task(), task()], [globalSrc], prefs({ groupBy: "none" }));
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe("");
    expect(groups[0].tasks).toHaveLength(2);
  });

  it("source: two named groups when two sources are non-empty", () => {
    const groups = buildView(
      [task({ sourceId: "s-global" }), task({ sourceId: "s-ws" })],
      [globalSrc, wsSrc],
      prefs({ groupBy: "source" }),
    );
    expect(groups.map((g) => g.title)).toEqual(["Personal", "Repo"]);
  });

  it("source: collapses to one unnamed group when only one source is non-empty", () => {
    const groups = buildView(
      [task({ sourceId: "s-global" }), task({ sourceId: "s-global" })],
      [globalSrc, wsSrc],
      prefs({ groupBy: "source" }),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe("");
  });

  it("status: one group per non-empty lane, in lane order", () => {
    const groups = buildView(
      [
        task({ lane: "blocked" }),
        task({ lane: "todo" }),
        task({ lane: "in_progress" }),
      ],
      [globalSrc],
      prefs({ groupBy: "status", laneFilter: ["todo", "in_progress", "blocked"] }),
    );
    expect(groups.map((g) => g.key)).toEqual(["todo", "in_progress", "blocked"]);
  });

  it("label: a multi-label task lands in every matching group; unlabeled trails", () => {
    const groups = buildView(
      [
        task({ labels: ["api", "ui"] }),
        task({ labels: ["ui"] }),
        task({ labels: [] }),
      ],
      [globalSrc],
      prefs({ groupBy: "label" }),
    );
    expect(groups.map((g) => g.title)).toEqual(["api", "ui", "No label"]);
    expect(groups[0].tasks).toHaveLength(1);
    expect(groups[1].tasks).toHaveLength(2);
    expect(groups[2].tasks).toHaveLength(1);
  });
});

describe("buildView — filter", () => {
  it("excludes done by default and reveals it when the lane is added", () => {
    const tasks = [task({ lane: "todo" }), task({ lane: "done" })];
    expect(buildView(tasks, [globalSrc], prefs({ groupBy: "none" }))[0].tasks).toHaveLength(1);
    expect(
      buildView(
        tasks,
        [globalSrc],
        prefs({ groupBy: "none", laneFilter: ["todo", "done"] }),
      )[0].tasks,
    ).toHaveLength(2);
  });

  it("label filter keeps a task with any matching label", () => {
    const groups = buildView(
      [task({ labels: ["api"] }), task({ labels: ["ui"] })],
      [globalSrc],
      prefs({ groupBy: "none", labelFilter: ["api"] }),
    );
    expect(groups[0].tasks).toHaveLength(1);
  });

  it("returns an empty status view when everything is filtered out", () => {
    const groups = buildView(
      [task({ lane: "done" })],
      [globalSrc],
      prefs({ groupBy: "status" }),
    );
    expect(groups).toEqual([]);
  });
});

describe("buildView — sort", () => {
  it("rank ascending by default", () => {
    const a = task({ rank: "0002" });
    const b = task({ rank: "0001" });
    const out = buildView([a, b], [globalSrc], prefs({ groupBy: "none" }))[0].tasks;
    expect(out.map((t) => t.rank)).toEqual(["0001", "0002"]);
  });

  it("updated: most recent first", () => {
    const a = task({ updatedAt: 10 });
    const b = task({ updatedAt: 99 });
    const out = buildView(
      [a, b],
      [globalSrc],
      prefs({ groupBy: "none", sortBy: "updated" }),
    )[0].tasks;
    expect(out[0].updatedAt).toBe(99);
  });

  it("priority: high, normal, low — and stable within a key", () => {
    const n1 = task({ priority: "normal", title: "n1" });
    const n2 = task({ priority: "normal", title: "n2" });
    const h = task({ priority: "high", title: "h" });
    const out = buildView(
      [n1, n2, h],
      [globalSrc],
      prefs({ groupBy: "none", sortBy: "priority" }),
    )[0].tasks;
    expect(out.map((t) => t.title)).toEqual(["h", "n1", "n2"]);
  });

  it("title: case-insensitive ascending", () => {
    const out = buildView(
      [task({ title: "banana" }), task({ title: "Apple" })],
      [globalSrc],
      prefs({ groupBy: "none", sortBy: "title" }),
    )[0].tasks;
    expect(out.map((t) => t.title)).toEqual(["Apple", "banana"]);
  });
});

describe("buildView — search", () => {
  it("matches title, label, and an exact id — and empty query passes all", () => {
    const a = task({ title: "Deploy the thing", labels: [] });
    const b = task({ title: "Nothing", labels: ["deploy"] });
    const c = task({ title: "Other", id: "task-xyz" });
    const run = (q: string) =>
      buildView([a, b, c], [globalSrc], prefs({ groupBy: "none", query: q }))[0]
        .tasks;
    expect(run("").length).toBe(3);
    expect(run("deploy").map((t) => t.id).sort()).toEqual([a.id, b.id].sort());
    expect(run("task-xyz").map((t) => t.id)).toEqual(["task-xyz"]);
  });

  it("empty input produces one empty group for a flat grouping", () => {
    const groups = buildView([], [globalSrc], prefs({ groupBy: "none" }));
    expect(groups[0].tasks).toEqual([]);
  });
});

describe("laneFilterLabel", () => {
  it('names the default (every lane but done) "Open"', () => {
    expect(laneFilterLabel(DEFAULT_LANE_FILTER)).toBe("Open");
    // order-independent
    expect(laneFilterLabel(["blocked", "todo", "in_progress"])).toBe("Open");
  });

  it('names the full set "All" and the empty set "None"', () => {
    expect(laneFilterLabel(["todo", "in_progress", "blocked", "done"])).toBe(
      "All",
    );
    expect(laneFilterLabel([])).toBe("None");
  });

  it("names a single custom lane, and counts two or more", () => {
    expect(laneFilterLabel(["done"])).toBe("Done");
    expect(laneFilterLabel(["todo", "done"])).toBe("2 lanes");
  });
});

describe("labelFilterLabel", () => {
  it('is "No labels" when nothing is selected (the default)', () => {
    expect(labelFilterLabel([])).toBe("No labels");
  });

  it("uses the given empty label — the sheet passes 'None'", () => {
    expect(labelFilterLabel([], "None")).toBe("None");
  });

  it("names one label, counts two or more (empty label is ignored)", () => {
    expect(labelFilterLabel(["backend"], "None")).toBe("backend");
    expect(labelFilterLabel(["backend", "frontend"], "None")).toBe("2 labels");
  });
});

describe("buildView across many workspace sources (phase 2)", () => {
  const src = (id: string, name: string): TaskSource => ({
    id,
    providerId: "silo",
    locator: `/${id}/tasks.jsonl`,
    scope: "workspace",
    workspaceId: id,
    name,
  });
  const alpha = src("s-a", "Alpha");
  const beta = src("s-b", "Beta");
  const gamma = src("s-c", "Gamma");
  const sources = [globalSrc, alpha, beta, gamma];

  const spread = () => [
    task({ sourceId: globalSrc.id, title: "Personal one", labels: ["home"] }),
    task({ sourceId: alpha.id, title: "Alpha one", lane: "in_progress" }),
    task({ sourceId: alpha.id, title: "Alpha two", labels: ["ui"] }),
    task({ sourceId: beta.id, title: "Beta one", lane: "blocked" }),
    task({ sourceId: gamma.id, title: "Gamma one", labels: ["ui"] }),
  ];

  it("groups by source, one header per contributing source, in set order", () => {
    const groups = buildView(spread(), sources, DEFAULT_VIEW_PREFS);
    expect(groups.map((g) => g.title)).toEqual([
      "Personal",
      "Alpha",
      "Beta",
      "Gamma",
    ]);
    expect(groups.map((g) => g.tasks.length)).toEqual([1, 2, 1, 1]);
  });

  it("omits a source whose every task is filtered out", () => {
    const prefs: ViewPrefs = { ...DEFAULT_VIEW_PREFS, query: "alpha" };
    const groups = buildView(spread(), sources, prefs);
    // Only Alpha survives, so it collapses to the single unlabeled group.
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe("");
    expect(groups[0].tasks).toHaveLength(2);
  });

  it("fans status groups across every source", () => {
    const prefs: ViewPrefs = {
      ...DEFAULT_VIEW_PREFS,
      groupBy: "status",
    };
    const groups = buildView(spread(), sources, prefs);
    const byTitle = Object.fromEntries(
      groups.map((g) => [g.title, g.tasks.map((t) => t.title)]),
    );
    expect(byTitle["Todo"]).toEqual(["Personal one", "Alpha two", "Gamma one"]);
    expect(byTitle["In progress"]).toEqual(["Alpha one"]);
    expect(byTitle["Blocked"]).toEqual(["Beta one"]);
  });

  it("fans label groups across every source", () => {
    const prefs: ViewPrefs = { ...DEFAULT_VIEW_PREFS, groupBy: "label" };
    const groups = buildView(spread(), sources, prefs);
    const ui = groups.find((g) => g.title === "ui");
    expect(ui?.tasks.map((t) => t.title)).toEqual(["Alpha two", "Gamma one"]);
    expect(groups.find((g) => g.title === "home")?.tasks).toHaveLength(1);
  });

  it("keeps a task filtered out of every group", () => {
    const prefs: ViewPrefs = {
      ...DEFAULT_VIEW_PREFS,
      labelFilter: ["ui"],
    };
    for (const groupBy of ["source", "status", "label", "none"] as const) {
      const groups = buildView(spread(), sources, { ...prefs, groupBy });
      const titles = groups.flatMap((g) => g.tasks.map((t) => t.title));
      expect(titles).not.toContain("Beta one");
      expect(titles).not.toContain("Personal one");
    }
  });

  it("sorts within each source group, not just globally", () => {
    const prefs: ViewPrefs = { ...DEFAULT_VIEW_PREFS, sortBy: "title" };
    const tasks = [
      task({ sourceId: alpha.id, title: "Zulu" }),
      task({ sourceId: beta.id, title: "Mike" }),
      task({ sourceId: alpha.id, title: "Alfa" }),
    ];
    const groups = buildView(tasks, sources, prefs);
    const alphaGroup = groups.find((g) => g.title === "Alpha");
    expect(alphaGroup?.tasks.map((t) => t.title)).toEqual(["Alfa", "Zulu"]);
  });
});

describe("buildView — sort direction (R12)", () => {
  it("desc reverses updated's own already-descending base order too — dir flips whichever base order a sortBy has, it doesn't redefine it", () => {
    const older = task({ updatedAt: 10 });
    const newer = task({ updatedAt: 99 });
    const ascDefault = buildView(
      [older, newer],
      [globalSrc],
      prefs({ groupBy: "none", sortBy: "updated" }),
    )[0].tasks;
    expect(ascDefault[0].updatedAt).toBe(99); // unchanged from the pre-R12 test above
    const desc = buildView(
      [older, newer],
      [globalSrc],
      prefs({ groupBy: "none", sortBy: "updated", sortDir: "desc" }),
    )[0].tasks;
    expect(desc[0].updatedAt).toBe(10);
  });
});

describe("buildView — source filter (R12)", () => {
  it("empty sourceFilter (the default) shows every source", () => {
    const groups = buildView(
      [task({ sourceId: "s-global" }), task({ sourceId: "s-ws" })],
      [globalSrc, wsSrc],
      prefs({ groupBy: "none" }),
    );
    expect(groups[0].tasks).toHaveLength(2);
  });

  it("scopes to the picked source(s) only", () => {
    const groups = buildView(
      [task({ sourceId: "s-global" }), task({ sourceId: "s-ws" })],
      [globalSrc, wsSrc],
      prefs({ groupBy: "none", sourceFilter: ["s-ws"] }),
    );
    expect(groups[0].tasks.map((t) => t.sourceId)).toEqual(["s-ws"]);
  });

  it("composes with the lane and label filters, not just replaces them", () => {
    const groups = buildView(
      [
        task({ sourceId: "s-ws", lane: "todo", labels: ["ui"] }),
        task({ sourceId: "s-ws", lane: "done", labels: ["ui"] }),
        task({ sourceId: "s-global", lane: "todo", labels: ["ui"] }),
      ],
      [globalSrc, wsSrc],
      prefs({ groupBy: "none", sourceFilter: ["s-ws"], labelFilter: ["ui"] }),
    );
    // Done is excluded by the default lane filter, Personal by sourceFilter —
    // only the first task survives all three filters at once.
    expect(groups[0].tasks).toHaveLength(1);
    expect(groups[0].tasks[0].lane).toBe("todo");
    expect(groups[0].tasks[0].sourceId).toBe("s-ws");
  });
});

describe("sourceFilterLabel", () => {
  it('is "All" when nothing is selected — the "All" option', () => {
    expect(sourceFilterLabel([], [globalSrc, wsSrc])).toBe("All");
  });

  it('is "None" when the unnamed global source is picked — the "No list" option', () => {
    const unnamed: TaskSource = { ...globalSrc, name: "" };
    expect(sourceFilterLabel([unnamed.id], [unnamed, wsSrc])).toBe("None");
  });

  it("names the single picked source by its own name", () => {
    expect(sourceFilterLabel(["s-ws"], [globalSrc, wsSrc])).toBe("Repo");
  });

  it('is "All" when the picked id resolves to no source', () => {
    expect(sourceFilterLabel(["gone"], [globalSrc, wsSrc])).toBe("All");
  });
});
