import { describe, expect, it, vi } from "vitest";
import { createFakeFileService } from "../../test/fakes";
import { createFileStore } from "./file-store";
import { parseJsonl, serializeJsonl } from "./jsonl";
import { newRecord, type SiloTaskRecord } from "./record";

const DIR = "/store/silo.tasks/global";
const FILE = `${DIR}/tasks.jsonl`;
const TMP = `${DIR}/.tasks.jsonl.tmp`;

function seedBody(...ids: string[]): string {
  return serializeJsonl({
    records: ids.map((id, i) =>
      newRecord({ id, title: id, rank: String(i + 1).padStart(4, "0"), now: 1 }),
    ),
    unparsed: [],
  });
}

function makeStore(over: Parameters<typeof createFileStore>[3] = {}) {
  const files = createFakeFileService();
  const store = createFileStore(files, DIR, "tasks.jsonl", {
    debounceMs: 0,
    ...over,
  });
  return { files, store };
}

describe("createFileStore", () => {
  it("reads an absent file as an empty list", async () => {
    const { store } = makeStore();
    await expect(store.load()).resolves.toEqual({ records: [], unparsed: [] });
  });

  it("writes through .tasks.jsonl.tmp then renames, in that order", async () => {
    const { files, store } = makeStore();
    const calls: string[] = [];
    const origWrite = files.writeText.bind(files);
    const origRename = files.rename.bind(files);
    files.writeText = async (p, c) => {
      calls.push(`write ${p}`);
      return origWrite(p, c);
    };
    files.rename = async (a, b) => {
      calls.push(`rename ${a} -> ${b}`);
      return origRename(a, b);
    };

    await store.mutate((records) =>
      records.push(newRecord({ id: "x", title: "x", rank: "0001", now: 1 })),
    );

    expect(calls).toEqual([`write ${TMP}`, `rename ${TMP} -> ${FILE}`]);
    expect(files.peek(TMP)).toBeUndefined();
    expect(parseJsonl(files.peek(FILE)!).records.map((r) => r.id)).toEqual(["x"]);
  });

  it("CAS: an external write landing before the rename is preserved", async () => {
    const { files, store } = makeStore();
    files.seed(FILE, seedBody("a"));

    // Simulate a concurrent writer: the first time we write our tmp file,
    // append a line to the real file underneath us.
    let hooked = false;
    const origWrite = files.writeText.bind(files);
    files.writeText = async (p, c) => {
      const r = await origWrite(p, c);
      if (p === TMP && !hooked) {
        hooked = true;
        const cur = parseJsonl(files.peek(FILE)!);
        files.seed(
          FILE,
          serializeJsonl({
            records: [
              ...cur.records,
              newRecord({ id: "external", title: "e", rank: "0009", now: 2 }),
            ],
            unparsed: cur.unparsed,
          }),
        );
      }
      return r;
    };

    await store.mutate((records) =>
      records.push(newRecord({ id: "mine", title: "m", rank: "0005", now: 3 })),
    );

    const ids = parseJsonl(files.peek(FILE)!).records.map((r) => r.id);
    expect(ids).toContain("external");
    expect(ids).toContain("mine");
    expect(ids).toContain("a");
  });

  it("CAS: rejects and leaves the file untouched when retries are exhausted", async () => {
    const { files, store } = makeStore({ maxRetries: 2 });
    files.seed(FILE, seedBody("a"));

    // Every tmp write triggers another external change → CAS never converges.
    const origWrite = files.writeText.bind(files);
    let n = 0;
    files.writeText = async (p, c) => {
      const r = await origWrite(p, c);
      if (p === TMP) {
        n += 1;
        files.seed(FILE, seedBody("a", `ext${n}`));
      }
      return r;
    };

    const before = files.peek(FILE);
    await expect(
      store.mutate((records) =>
        records.push(newRecord({ id: "mine", title: "m", rank: "0005", now: 3 })),
      ),
    ).rejects.toThrow(/kept changing/);
    // The last external write is what's on disk; our mutation is not.
    expect(parseJsonl(files.peek(FILE)!).records.map((r) => r.id)).not.toContain(
      "mine",
    );
    expect(files.peek(FILE)).not.toBe(before);
  });

  it("serializes concurrent mutations — no interleaved read-modify-write", async () => {
    const { files, store } = makeStore();
    files.seed(FILE, seedBody());

    await Promise.all([
      store.mutate((r) =>
        r.push(newRecord({ id: "one", title: "1", rank: "0001", now: 1 })),
      ),
      store.mutate((r) =>
        r.push(newRecord({ id: "two", title: "2", rank: "0002", now: 2 })),
      ),
    ]);

    const ids = parseJsonl(files.peek(FILE)!).records.map((r) => r.id);
    expect(ids.sort()).toEqual(["one", "two"]);
  });

  it("suppresses the watch event for its own write (content-based)", async () => {
    const { files, store } = makeStore();
    files.seed(FILE, seedBody());
    const onChange = vi.fn();
    store.watch(onChange);

    await store.mutate((r) =>
      r.push(newRecord({ id: "self", title: "s", rank: "0001", now: 1 })),
    );
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("fires the watch for an external write, and ignores non-tasks.jsonl events", async () => {
    const { files, store } = makeStore();
    files.seed(FILE, seedBody("a"));
    const onChange = vi.fn();
    store.watch(onChange);

    await files.writeText(`${DIR}/notes.md`, "hi");
    await new Promise((r) => setTimeout(r, 0));
    expect(onChange).not.toHaveBeenCalled();

    files.seed(FILE, seedBody("a", "b"));
    await files.writeText(`${DIR}/tasks.jsonl`, seedBody("a", "b", "c"));
    await new Promise((r) => setTimeout(r, 0));
    expect(onChange).toHaveBeenCalled();
  });

  it("a failed rename rejects and leaves tasks.jsonl unchanged", async () => {
    const { files, store } = makeStore({ maxRetries: 0 });
    files.seed(FILE, seedBody("a"));
    files.rename = async () => {
      throw new Error("EPERM");
    };
    const before = files.peek(FILE);
    await expect(
      store.mutate((r: SiloTaskRecord[]) =>
        r.push(newRecord({ id: "x", title: "x", rank: "0002", now: 2 })),
      ),
    ).rejects.toThrow();
    expect(files.peek(FILE)).toBe(before);
  });
});
