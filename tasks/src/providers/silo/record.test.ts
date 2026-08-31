import { describe, expect, it } from "vitest";
import type { DetailSection } from "../../model/detail";
import {
  applyPatch,
  newRecord,
  toDetailSections,
  toTask,
  type SiloTaskRecord,
} from "./record";

function rec(over: Partial<SiloTaskRecord> = {}): SiloTaskRecord {
  return {
    v: 1,
    id: "t1",
    title: "Ship it",
    lane: "todo",
    priority: "high",
    rank: "000000000007",
    labels: ["a", "b"],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_100_000,
    ...over,
  };
}

describe("toTask", () => {
  it("maps every core field", () => {
    const task = toTask(rec(), "src-1");
    expect(task).toEqual({
      id: "t1",
      sourceId: "src-1",
      title: "Ship it",
      lane: "todo",
      statusLabel: "Todo",
      priority: "high",
      rank: "000000000007",
      parentId: null,
      labels: ["a", "b"],
      assignees: [],
      updatedAt: 1_700_000_100_000,
    });
  });

  it("uses the human lane word for statusLabel", () => {
    expect(toTask(rec({ lane: "in_progress" }), "s").statusLabel).toBe(
      "In progress",
    );
    expect(toTask(rec({ lane: "blocked" }), "s").statusLabel).toBe("Blocked");
    expect(toTask(rec({ lane: "done" }), "s").statusLabel).toBe("Done");
  });
});

describe("toDetailSections", () => {
  it("emits description / due / criteria / created only through descriptors", () => {
    const sections = toDetailSections(
      rec({
        description: "why",
        dueDate: "2026-09-01",
        acceptanceCriteria: [{ text: "x", done: false }],
      }),
    );
    const byLabel = (l: string) => sections.find((s) => s.label === l);
    expect(byLabel("Description")).toMatchObject({ kind: "text", value: "why" });
    expect(byLabel("Due date")).toMatchObject({
      kind: "field",
      value: "2026-09-01",
      format: "date",
    });
    expect(byLabel("Acceptance criteria")).toMatchObject({ kind: "checklist" });
    expect(byLabel("Created")).toMatchObject({ kind: "field" });
  });

  it("tags description / due / criteria with a key; created has none", () => {
    const sections = toDetailSections(rec());
    const key = (l: string) => sections.find((s) => s.label === l)?.key;
    expect(key("Description")).toBe("description");
    expect(key("Due date")).toBe("dueDate");
    expect(key("Acceptance criteria")).toBe("acceptanceCriteria");
    expect(key("Created")).toBeUndefined();
  });

  it("does not surface a section for a schema field the model doesn't carry", () => {
    const labels = toDetailSections(rec()).map((s: DetailSection) => s.label);
    expect(labels).not.toContain("Assignees");
    expect(labels).not.toContain("Parent");
  });
});

describe("applyPatch", () => {
  it("maps providerFields onto the record and bumps updatedAt", () => {
    const next = applyPatch(
      rec(),
      { providerFields: { description: "d", dueDate: "2026-01-01" } },
      42,
    );
    expect(next.description).toBe("d");
    expect(next.dueDate).toBe("2026-01-01");
    expect(next.updatedAt).toBe(42);
  });

  it("ignores an unknown providerFields key", () => {
    const next = applyPatch(rec(), { providerFields: { nonsense: 1 } }, 42);
    expect((next as Record<string, unknown>).nonsense).toBeUndefined();
    expect(next.title).toBe("Ship it");
  });

  it("clears closedAt off a done lane and stamps it on", () => {
    const done = applyPatch(rec(), { lane: "done" }, 99);
    expect(done.closedAt).toBe(99);
    const reopened = applyPatch(done, { lane: "todo" }, 100);
    expect(reopened.closedAt).toBeNull();
  });
});

describe("newRecord", () => {
  it("defaults lane/priority and carries providerFields through", () => {
    const r = newRecord({
      id: "n1",
      title: "New",
      rank: "000000000001",
      providerFields: { description: "hi" },
      now: 5,
    });
    expect(r).toMatchObject({
      v: 1,
      lane: "todo",
      priority: "normal",
      description: "hi",
      createdAt: 5,
      updatedAt: 5,
    });
  });
});
