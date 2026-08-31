import { describe, expect, it } from "vitest";
import { createFakeFileService } from "../../test/fakes";
import type { TaskSource } from "../../model/source";
import { SiloTaskProvider } from "./provider";
import { parseJsonl } from "./jsonl";

const source: TaskSource = {
  id: "s1",
  providerId: "silo",
  locator: "/data/silo.tasks/global/tasks.jsonl",
  scope: "global",
  name: "Personal",
};

function setup() {
  const files = createFakeFileService();
  const provider = new SiloTaskProvider(files, { debounceMs: 0 });
  return { files, provider };
}

describe("SiloTaskProvider", () => {
  it("create / update / setLane / delete each land in the file", async () => {
    const { files, provider } = setup();

    const created = await provider.createTask(source, { title: "First" });
    expect(created.title).toBe("First");
    expect(parseJsonl(files.peek(source.locator)!).records).toHaveLength(1);

    const updated = await provider.updateTask(source, created.id, {
      title: "Renamed",
      priority: "high",
    });
    expect(updated.title).toBe("Renamed");
    expect(updated.priority).toBe("high");

    const done = await provider.setLane(source, created.id, "done");
    expect(done.lane).toBe("done");

    await provider.deleteTask(source, created.id);
    expect(parseJsonl(files.peek(source.locator)!).records).toHaveLength(0);
  });

  it("routes a providerFields edit onto the record", async () => {
    const { provider } = setup();
    const t = await provider.createTask(source, { title: "X" });
    await provider.updateTask(source, t.id, {
      providerFields: { description: "the why", dueDate: "2026-09-09" },
    });
    const sections = await provider.detail(source, t.id);
    expect(sections.find((s) => s.label === "Description")).toMatchObject({
      value: "the why",
    });
    expect(sections.find((s) => s.label === "Due date")).toMatchObject({
      value: "2026-09-09",
    });
  });

  it("detail() for a missing id rejects", async () => {
    const { provider } = setup();
    await expect(provider.detail(source, "nope")).rejects.toThrow(/nope/);
  });

  it("list() reports unparsed lines through the diagnostics handler", async () => {
    const files = createFakeFileService();
    const seen: number[] = [];
    const provider = new SiloTaskProvider(
      files,
      { debounceMs: 0 },
      (_s, unparsed) => seen.push(unparsed.length),
    );
    files.seed(source.locator, `{ broken\n`);
    await provider.list(source);
    expect(seen).toEqual([1]);
  });
});
