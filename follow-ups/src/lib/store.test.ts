import { describe, expect, it } from "vitest";
import {
  clearFollowUp,
  statusLabel,
  summarizeMarks,
  getFollowUp,
  isMarked,
  parseMarks,
  pruneWorkspace,
  serializeMarks,
  setFollowUp,
  setNote,
  toggleFollowUp,
  type MarksState,
} from "./store";

const T0 = 1_700_000_000_000;

function state(): MarksState {
  return new Map();
}

/** A live-id set, as the pruner and the counters take them. */
const live = (ids: string[]): ReadonlySet<string> => new Set(ids);

describe("setFollowUp — changed-ness", () => {
  it("adds a mark that wasn't there", () => {
    const s = state();
    expect(
      setFollowUp(s, "ws1", "editor", "e1", { labelId: "warn" }, T0),
    ).toBe("added");
    expect(getFollowUp(s, "ws1", "editor", "e1")).toEqual({
      labelId: "warn",
      note: "",
      markedAt: T0,
    });
  });

  it("reports a re-label as updated — the 0.2.x boolean swallowed this", () => {
    const s = state();
    setFollowUp(s, "ws1", "editor", "e1", { labelId: "warn" }, T0);
    expect(
      setFollowUp(s, "ws1", "editor", "e1", { labelId: "error" }, T0 + 5_000),
    ).toBe("updated");
    expect(getFollowUp(s, "ws1", "editor", "e1")?.labelId).toBe("error");
  });

  it("preserves markedAt across a relabel — relabelling isn't re-marking", () => {
    const s = state();
    setFollowUp(s, "ws1", "editor", "e1", { labelId: "warn" }, T0);
    setFollowUp(s, "ws1", "editor", "e1", { labelId: "ok" }, T0 + 60_000);
    expect(getFollowUp(s, "ws1", "editor", "e1")?.markedAt).toBe(T0);
  });

  it("is none only when the label *and* the note are both unchanged", () => {
    const s = state();
    setFollowUp(s, "ws1", "editor", "e1", { labelId: "warn", note: "why" }, T0);
    expect(
      setFollowUp(
        s,
        "ws1",
        "editor",
        "e1",
        { labelId: "warn", note: "why" },
        T0 + 1,
      ),
    ).toBe("none");
  });

  it("reports a note-only change as updated", () => {
    const s = state();
    setFollowUp(s, "ws1", "editor", "e1", { labelId: "warn" }, T0);
    expect(
      setFollowUp(
        s,
        "ws1",
        "editor",
        "e1",
        { labelId: "warn", note: "waiting on Ana" },
        T0,
      ),
    ).toBe("updated");
    expect(getFollowUp(s, "ws1", "editor", "e1")?.note).toBe("waiting on Ana");
  });

  it("keeps the existing note when the update omits one", () => {
    const s = state();
    setFollowUp(s, "ws1", "editor", "e1", { labelId: "warn", note: "n" }, T0);
    setFollowUp(s, "ws1", "editor", "e1", { labelId: "ok" }, T0);
    expect(getFollowUp(s, "ws1", "editor", "e1")?.note).toBe("n");
  });
});

describe("setNote", () => {
  it("is none on an unmarked tab — a note needs a follow-up to hang on", () => {
    const s = state();
    expect(setNote(s, "ws1", "editor", "e1", "hello")).toBe("none");
    expect(isMarked(s, "ws1", "editor", "e1")).toBe(false);
  });

  it("is none when the note is already that string", () => {
    const s = state();
    setFollowUp(s, "ws1", "editor", "e1", { labelId: "warn", note: "n" }, T0);
    expect(setNote(s, "ws1", "editor", "e1", "n")).toBe("none");
  });

  it("clears a note without clearing the follow-up", () => {
    const s = state();
    setFollowUp(s, "ws1", "editor", "e1", { labelId: "warn", note: "n" }, T0);
    expect(setNote(s, "ws1", "editor", "e1", "")).toBe("updated");
    expect(getFollowUp(s, "ws1", "editor", "e1")).toEqual({
      labelId: "warn",
      note: "",
      markedAt: T0,
    });
  });
});

describe("clearFollowUp / toggleFollowUp", () => {
  it("removes a mark and drops the now-empty workspace entry", () => {
    const s = state();
    setFollowUp(s, "ws1", "editor", "e1", { labelId: "warn" }, T0);
    expect(clearFollowUp(s, "ws1", "editor", "e1")).toBe("removed");
    expect(s.has("ws1")).toBe(false);
  });

  it("is none when there was nothing to clear", () => {
    const s = state();
    expect(clearFollowUp(s, "ws1", "editor", "e1")).toBe("none");
    setFollowUp(s, "ws1", "editor", "e1", { labelId: "warn" }, T0);
    expect(clearFollowUp(s, "ws1", "editor", "other")).toBe("none");
  });

  it("marks with the default label, then clears", () => {
    const s = state();
    expect(toggleFollowUp(s, "ws1", "terminal", "t1", "ok", T0)).toBe("added");
    expect(getFollowUp(s, "ws1", "terminal", "t1")?.labelId).toBe("ok");
    expect(toggleFollowUp(s, "ws1", "terminal", "t1", "ok", T0)).toBe("removed");
  });
});

describe("kinds are separate buckets", () => {
  it("keys an editor, a terminal, and a panel independently", () => {
    const s = state();
    setFollowUp(s, "ws1", "editor", "x", { labelId: "warn" }, T0);
    expect(isMarked(s, "ws1", "terminal", "x")).toBe(false);
    expect(isMarked(s, "ws1", "panel", "x")).toBe(false);
    setFollowUp(s, "ws1", "panel", "x", { labelId: "ok" }, T0);
    expect(getFollowUp(s, "ws1", "editor", "x")?.labelId).toBe("warn");
    expect(getFollowUp(s, "ws1", "panel", "x")?.labelId).toBe("ok");
  });
});

describe("pruneWorkspace", () => {
  it("drops marks whose tab is gone, across all three kinds", () => {
    const s = state();
    setFollowUp(s, "ws1", "editor", "e1", { labelId: "warn" }, T0);
    setFollowUp(s, "ws1", "editor", "gone", { labelId: "warn" }, T0);
    setFollowUp(s, "ws1", "terminal", "t1", { labelId: "warn" }, T0);
    setFollowUp(s, "ws1", "panel", "p-gone", { labelId: "warn" }, T0);
    expect(
      pruneWorkspace(s, "ws1", live(["e1"]), live(["t1"]), live([])),
    ).toBe(true);
    expect(isMarked(s, "ws1", "editor", "e1")).toBe(true);
    expect(isMarked(s, "ws1", "editor", "gone")).toBe(false);
    expect(isMarked(s, "ws1", "panel", "p-gone")).toBe(false);
  });

  it("is false when nothing was stale, and drops an emptied workspace", () => {
    const s = state();
    setFollowUp(s, "ws1", "editor", "e1", { labelId: "warn" }, T0);
    expect(pruneWorkspace(s, "ws1", live(["e1"]), live([]), live([]))).toBe(false);
    expect(pruneWorkspace(s, "ws1", live([]), live([]), live([]))).toBe(true);
    expect(s.has("ws1")).toBe(false);
  });
});

describe("summarizeMarks", () => {
  it("counts only live tabs, across all three kinds", () => {
    const s = state();
    setFollowUp(s, "ws1", "editor", "e1", { labelId: "warn" }, T0);
    setFollowUp(s, "ws1", "editor", "gone", { labelId: "warn" }, T0);
    setFollowUp(s, "ws1", "terminal", "t1", { labelId: "ok" }, T0);
    setFollowUp(s, "ws1", "panel", "rec-1", { labelId: "error" }, T0);
    expect(summarizeMarks(s, "ws1").count).toBe(4);
    expect(
      summarizeMarks(s, "ws1", live(["e1"]), live(["t1"]), live(["rec-1"])).count,
    ).toBe(3);
  });

  it("rolls every label into one count — the panel line is a single row", () => {
    const s = state();
    setFollowUp(s, "ws1", "editor", "e1", { labelId: "warn" }, T0);
    setFollowUp(s, "ws1", "editor", "e2", { labelId: "ok" }, T0);
    setFollowUp(s, "ws1", "terminal", "t1", { labelId: "error" }, T0);
    expect(summarizeMarks(s, "ws1").count).toBe(3);
  });

  it("breaks the count down per label, across kinds and live tabs only", () => {
    const s = state();
    setFollowUp(s, "ws1", "editor", "e1", { labelId: "warn" }, T0);
    setFollowUp(s, "ws1", "editor", "e2", { labelId: "warn" }, T0);
    setFollowUp(s, "ws1", "terminal", "t1", { labelId: "ok" }, T0);
    setFollowUp(s, "ws1", "panel", "rec-1", { labelId: "error" }, T0);
    setFollowUp(s, "ws1", "editor", "gone", { labelId: "muted" }, T0);
    expect(summarizeMarks(s, "ws1").byLabel).toEqual({
      warn: 2,
      ok: 1,
      error: 1,
      muted: 1,
    });
    // A label whose only tab is dead drops out entirely rather than reading 0.
    expect(
      summarizeMarks(s, "ws1", live(["e1", "e2"]), live(["t1"]), live(["rec-1"]))
        .byLabel,
    ).toEqual({ warn: 2, ok: 1, error: 1 });
  });

  it("counts marks migrated from the legacy boolean form", () => {
    const s = parseMarks({ ws1: { editors: ["e1", "e2"] } }, "warn");
    expect(summarizeMarks(s, "ws1")).toEqual({
      count: 2,
      byLabel: { warn: 2 },
    });
  });

  it("is zero for an unknown workspace", () => {
    expect(summarizeMarks(state(), "nope")).toEqual({ count: 0, byLabel: {} });
  });
});

describe("statusLabel", () => {
  it("singularizes one follow-up", () => {
    expect(statusLabel(1)).toBe("1 follow-up");
  });

  it("pluralizes everything else", () => {
    expect(statusLabel(0)).toBe("0 follow-ups");
    expect(statusLabel(4)).toBe("4 follow-ups");
  });
});

describe("parseMarks — legacy 0.2.x migration", () => {
  it("maps a legacy string[] to the default label, no note, markedAt 0", () => {
    const s = parseMarks(
      { ws1: { editors: ["e1", "e2"], terminals: [], panels: [] } },
      "ok",
    );
    expect(getFollowUp(s, "ws1", "editor", "e1")).toEqual({
      labelId: "ok",
      note: "",
      markedAt: 0,
    });
    expect(summarizeMarks(s, "ws1").count).toBe(2);
  });

  it("branches per *kind*, so a half-migrated workspace still parses", () => {
    // Nothing rewrites storage until the first mutation, so one workspace can
    // genuinely hold a legacy array beside a new-form record.
    const s = parseMarks(
      {
        ws1: {
          editors: ["e1"],
          terminals: { t1: { label: "error", note: "stuck", markedAt: T0 } },
          panels: [],
        },
      },
      "warn",
    );
    expect(getFollowUp(s, "ws1", "editor", "e1")).toEqual({
      labelId: "warn",
      note: "",
      markedAt: 0,
    });
    expect(getFollowUp(s, "ws1", "terminal", "t1")).toEqual({
      labelId: "error",
      note: "stuck",
      markedAt: T0,
    });
  });

  it("drops empty strings out of a legacy array", () => {
    const s = parseMarks({ ws1: { editors: ["", "e1"], terminals: [] } }, "warn");
    expect(summarizeMarks(s, "ws1").count).toBe(1);
  });
});

describe("parseMarks — the retired `accent` label", () => {
  it("keeps a tab flagged under the old id, on the new color", () => {
    const bag = {
      ws1: {
        editors: { e1: { label: "accent", note: "waiting", markedAt: T0 } },
        terminals: {},
        panels: {},
      },
    };
    expect(getFollowUp(parseMarks(bag, "warn"), "ws1", "editor", "e1")).toEqual(
      { labelId: "info", note: "waiting", markedAt: T0 },
    );
  });

  it("still falls back to the default for an id from neither set", () => {
    const bag = {
      ws1: {
        editors: { e1: { label: "chartreuse" } },
        terminals: {},
        panels: {},
      },
    };
    expect(
      getFollowUp(parseMarks(bag, "warn"), "ws1", "editor", "e1")?.labelId,
    ).toBe("warn");
  });
});

describe("parseMarks — the current form", () => {
  it("round-trips a full record", () => {
    const bag = {
      ws1: {
        editors: { e1: { label: "info", note: "waiting", markedAt: T0 } },
        terminals: {},
        panels: { "rec-1": { label: "muted" } },
      },
    };
    const s = parseMarks(bag, "warn");
    expect(getFollowUp(s, "ws1", "editor", "e1")).toEqual({
      labelId: "info",
      note: "waiting",
      markedAt: T0,
    });
    // A panel mark is keyed on the DockPanelRecord's *stable* id.
    expect(getFollowUp(s, "ws1", "panel", "rec-1")).toEqual({
      labelId: "muted",
      note: "",
      markedAt: 0,
    });
  });

  it("resolves an unknown label id to the default without throwing", () => {
    const s = parseMarks(
      { ws1: { editors: { e1: { label: "chartreuse" } } } },
      "ok",
    );
    expect(getFollowUp(s, "ws1", "editor", "e1")?.labelId).toBe("ok");
  });

  it("coerces a non-number markedAt to 0 and a non-string note to empty", () => {
    const s = parseMarks(
      {
        ws1: {
          editors: {
            e1: { label: "warn", markedAt: "yesterday", note: 7 },
            e2: { label: "warn", markedAt: Number.NaN },
            e3: { label: "warn", markedAt: Number.POSITIVE_INFINITY },
          },
        },
      },
      "warn",
    );
    for (const id of ["e1", "e2", "e3"]) {
      expect(getFollowUp(s, "ws1", "editor", id)?.markedAt).toBe(0);
    }
    expect(getFollowUp(s, "ws1", "editor", "e1")?.note).toBe("");
  });

  it("drops non-object entry values", () => {
    const s = parseMarks(
      { ws1: { editors: { e1: "nope", e2: null, e3: ["a"], e4: { label: "ok" } } } },
      "warn",
    );
    // Only the one well-formed entry survives.
    expect(summarizeMarks(s, "ws1").count).toBe(1);
    expect(isMarked(s, "ws1", "editor", "e4")).toBe(true);
  });

  it("skips garbage at the top level and per workspace", () => {
    expect(parseMarks(null, "warn").size).toBe(0);
    expect(parseMarks("nope", "warn").size).toBe(0);
    expect(parseMarks(42, "warn").size).toBe(0);
    expect(parseMarks({ ws1: "nope", ws2: null }, "warn").size).toBe(0);
  });

  it("drops a workspace whose every kind is empty", () => {
    const s = parseMarks(
      { ws1: { editors: {}, terminals: {}, panels: {} } },
      "warn",
    );
    expect(s.size).toBe(0);
  });
});

describe("serializeMarks", () => {
  it("writes canonical key order, workspaces and ids both sorted", () => {
    const s = state();
    setFollowUp(s, "ws2", "editor", "b", { labelId: "warn" }, T0);
    setFollowUp(s, "ws1", "editor", "z", { labelId: "warn" }, T0);
    setFollowUp(s, "ws1", "editor", "a", { labelId: "warn" }, T0);
    const bag = serializeMarks(s);
    expect(Object.keys(bag)).toEqual(["ws1", "ws2"]);
    expect(Object.keys(bag.ws1.editors)).toEqual(["a", "z"]);
  });

  it("omits an empty note and a zero markedAt rather than storing defaults", () => {
    const s = parseMarks({ ws1: { editors: ["e1"] } }, "warn");
    expect(serializeMarks(s).ws1.editors.e1).toEqual({ label: "warn" });
  });

  it("is idempotent over a parse round-trip", () => {
    const bag = {
      ws1: {
        editors: { e1: { label: "info", note: "waiting", markedAt: T0 } },
        terminals: { t1: { label: "ok" } },
        panels: {},
      },
    };
    const once = serializeMarks(parseMarks(bag, "warn"));
    const twice = serializeMarks(parseMarks(once, "warn"));
    expect(once).toEqual(bag);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it("canonicalizes a legacy bag into the record form", () => {
    const once = serializeMarks(
      parseMarks({ ws1: { editors: ["b", "a"], terminals: [], panels: [] } }, "ok"),
    );
    expect(once).toEqual({
      ws1: {
        editors: { a: { label: "ok" }, b: { label: "ok" } },
        terminals: {},
        panels: {},
      },
    });
    expect(JSON.stringify(serializeMarks(parseMarks(once, "ok")))).toBe(
      JSON.stringify(once),
    );
  });
});
