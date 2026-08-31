import { describe, expect, it } from "vitest";
import { parseJsonl, serializeJsonl } from "./jsonl";
import type { SiloTaskRecord } from "./record";

function rec(over: Partial<SiloTaskRecord> = {}): SiloTaskRecord {
  return {
    v: 1,
    id: "t1",
    title: "A",
    lane: "todo",
    priority: "normal",
    rank: "000000000001",
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

describe("parseJsonl / serializeJsonl", () => {
  it("round-trips valid records", () => {
    const body = serializeJsonl({ records: [rec(), rec({ id: "t2" })], unparsed: [] });
    const parsed = parseJsonl(body);
    expect(parsed.records.map((r) => r.id)).toEqual(["t1", "t2"]);
    expect(parsed.unparsed).toEqual([]);
    expect(serializeJsonl(parsed)).toBe(body);
  });

  it("drops blank and trailing lines without treating them as unparsed", () => {
    const parsed = parseJsonl(`\n${JSON.stringify(rec())}\n\n`);
    expect(parsed.records).toHaveLength(1);
    expect(parsed.unparsed).toEqual([]);
  });

  it("keeps a corrupt line verbatim at its index and re-emits it", () => {
    const good = JSON.stringify(rec());
    const body = `${good}\n{ not json\n${JSON.stringify(rec({ id: "t2" }))}`;
    const parsed = parseJsonl(body);
    expect(parsed.records.map((r) => r.id)).toEqual(["t1", "t2"]);
    expect(parsed.unparsed).toEqual([{ index: 1, line: "{ not json" }]);
    const out = parseJsonl(serializeJsonl(parsed));
    expect(out.unparsed).toEqual([{ index: 1, line: "{ not json" }]);
    expect(out.records.map((r) => r.id)).toEqual(["t1", "t2"]);
  });

  it("routes a record with a higher schema version to unparsed", () => {
    const line = JSON.stringify({ ...rec(), v: 2 });
    const parsed = parseJsonl(line);
    expect(parsed.records).toEqual([]);
    expect(parsed.unparsed[0].line).toBe(line);
  });

  it("preserves unknown keys through a round trip", () => {
    const withExtra = { ...rec(), somethingNew: { a: 1 } };
    const parsed = parseJsonl(JSON.stringify(withExtra));
    expect((parsed.records[0] as Record<string, unknown>).somethingNew).toEqual({
      a: 1,
    });
    const reparsed = parseJsonl(serializeJsonl(parsed));
    expect(
      (reparsed.records[0] as Record<string, unknown>).somethingNew,
    ).toEqual({ a: 1 });
  });

  it("serializes empty input to an empty string", () => {
    expect(serializeJsonl({ records: [], unparsed: [] })).toBe("");
    expect(parseJsonl("")).toEqual({ records: [], unparsed: [] });
  });
});
