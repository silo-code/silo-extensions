import { describe, expect, it } from "vitest";
import {
  LABEL_IDS,
  SHIPPED_NAMES,
  coerceLabels,
  defaultLabel,
  defaultLabels,
  labelById,
  labelColor,
  migrateLabelId,
  renameLabel,
  reorderLabels,
  setDefaultLabel,
  validateLabelName,
  type FollowUpLabel,
} from "./labels";

const ids = (labels: readonly FollowUpLabel[]) => labels.map((l) => l.id);

describe("coerceLabels — the invariants every consumer relies on", () => {
  it("is the shipped five, warn default, for an empty bag", () => {
    const labels = coerceLabels(undefined);
    expect(ids(labels)).toEqual([...LABEL_IDS]);
    expect(defaultLabel(labels).id).toBe("warn");
    expect(labels.map((l) => l.name)).toEqual(
      LABEL_IDS.map((id) => SHIPPED_NAMES[id]),
    );
  });

  it("is always exactly five, whatever the bag held", () => {
    for (const raw of [
      null,
      "nonsense",
      42,
      [],
      [{ id: "ok" }],
      [{ id: "ok" }, { id: "ok" }, { id: "ok" }],
      [{ id: "nope" }, { id: "also-nope" }],
    ]) {
      expect(coerceLabels(raw)).toHaveLength(5);
    }
  });

  it("drops an unknown id and keeps the five real ones", () => {
    const labels = coerceLabels([
      { id: "purple", name: "Nope" },
      { id: "ok", name: "Review me" },
    ]);
    expect(ids(labels)).toEqual(["ok", "warn", "error", "info", "muted"]);
    expect(labelById(labels, "ok").name).toBe("Review me");
  });

  it("promotes the first label when nothing claims the default", () => {
    const labels = coerceLabels([
      { id: "error", name: "Blocked" },
      { id: "ok", name: "Needs review" },
    ]);
    expect(defaultLabel(labels).id).toBe("error");
    expect(labels.filter((l) => l.isDefault)).toHaveLength(1);
  });

  it("keeps the first default when two claim it", () => {
    const labels = coerceLabels([
      { id: "ok", name: "Needs review", isDefault: true },
      { id: "error", name: "Blocked", isDefault: true },
    ]);
    expect(defaultLabel(labels).id).toBe("ok");
    expect(labels.filter((l) => l.isDefault)).toHaveLength(1);
  });

  it("falls back to the shipped name for a missing or blank one", () => {
    const labels = coerceLabels([
      { id: "ok" },
      { id: "error", name: "   " },
      { id: "warn", name: "" },
    ]);
    expect(labelById(labels, "ok").name).toBe(SHIPPED_NAMES.ok);
    expect(labelById(labels, "error").name).toBe(SHIPPED_NAMES.error);
    expect(labelById(labels, "warn").name).toBe(SHIPPED_NAMES.warn);
  });

  it("trims a stored name", () => {
    const labels = coerceLabels([{ id: "ok", name: "  Review  " }]);
    expect(labelById(labels, "ok").name).toBe("Review");
  });

  it("honors the stored order, appending ids it never named", () => {
    const labels = coerceLabels([{ id: "muted" }, { id: "info" }]);
    expect(ids(labels)).toEqual(["muted", "info", "warn", "ok", "error"]);
  });

  it("ignores a duplicate id rather than yielding six", () => {
    const labels = coerceLabels([
      { id: "ok", name: "First" },
      { id: "ok", name: "Second" },
    ]);
    expect(labels).toHaveLength(5);
    expect(labelById(labels, "ok").name).toBe("First");
  });

  it("ignores non-object entries", () => {
    const labels = coerceLabels(["ok", null, 7, { id: "error" }]);
    expect(labels).toHaveLength(5);
    expect(ids(labels)[0]).toBe("error");
  });
});

describe("labelById / labelColor", () => {
  it("resolves an unknown id to the default rather than throwing", () => {
    const labels = coerceLabels([{ id: "ok", isDefault: true }]);
    expect(labelById(labels, "chartreuse").id).toBe("ok");
    expect(labelColor(labels, "chartreuse")).toBe("ok");
  });

  it("maps a label id straight to its own tab color — the id *is* the color", () => {
    const labels = defaultLabels();
    for (const id of LABEL_IDS) expect(labelColor(labels, id)).toBe(id);
  });
});

describe("migrateLabelId — the retired `accent` slot", () => {
  it("carries a label saved under the old id onto the new one", () => {
    expect(migrateLabelId("accent")).toBe("info");
  });

  it("leaves a current id alone", () => {
    for (const id of LABEL_IDS) expect(migrateLabelId(id)).toBe(id);
  });

  it("reports an id from neither set as unknown", () => {
    expect(migrateLabelId("chartreuse")).toBeNull();
    expect(migrateLabelId(7)).toBeNull();
    expect(migrateLabelId(undefined)).toBeNull();
  });

  it("keeps the user's own name and default when the id moves", () => {
    const labels = coerceLabels([
      { id: "accent", name: "Waiting on Ana", isDefault: true },
    ]);
    expect(labelById(labels, "info").name).toBe("Waiting on Ana");
    expect(labelById(labels, "info").isDefault).toBe(true);
    expect(ids(labels)).toHaveLength(5);
    expect(ids(labels)).not.toContain("accent");
  });

  it("does not yield six when both the old and new id are stored", () => {
    const labels = coerceLabels([
      { id: "info", name: "New" },
      { id: "accent", name: "Old" },
    ]);
    expect(ids(labels)).toHaveLength(5);
    // First one named wins, same rule a duplicate id already follows.
    expect(labelById(labels, "info").name).toBe("New");
  });
});

describe("coerceLabels — retired shipped names", () => {
  it("replaces the old shipped name with the current one", () => {
    const labels = coerceLabels([{ id: "accent", name: "Waiting on agent" }]);
    expect(labelById(labels, "info").name).toBe("In progress");
  });

  it("replaces it under the new id too, for storage this build wrote", () => {
    const labels = coerceLabels([{ id: "info", name: "Waiting on agent" }]);
    expect(labelById(labels, "info").name).toBe("In progress");
  });

  it("leaves a real rename alone", () => {
    const labels = coerceLabels([{ id: "info", name: "Waiting on Ana" }]);
    expect(labelById(labels, "info").name).toBe("Waiting on Ana");
  });

  it("only applies to the label that retired the name", () => {
    const labels = coerceLabels([{ id: "muted", name: "Waiting on agent" }]);
    expect(labelById(labels, "muted").name).toBe("Waiting on agent");
  });
});

describe("renameLabel", () => {
  it("renames one label and leaves the rest alone", () => {
    const next = renameLabel(defaultLabels(), "ok", "  Peer review  ");
    expect(labelById(next, "ok").name).toBe("Peer review");
    expect(labelById(next, "warn").name).toBe(SHIPPED_NAMES.warn);
  });

  it("refuses a blank name rather than persisting an unreadable row", () => {
    const next = renameLabel(defaultLabels(), "ok", "   ");
    expect(labelById(next, "ok").name).toBe(SHIPPED_NAMES.ok);
  });
});

describe("reorderLabels", () => {
  it("moves a label and keeps all five", () => {
    const next = reorderLabels(defaultLabels(), 0, 4);
    expect(ids(next)).toEqual(["ok", "error", "info", "muted", "warn"]);
  });

  it("is a no-op for an out-of-range or identity move", () => {
    const base = defaultLabels();
    for (const [from, to] of [
      [0, 0],
      [-1, 2],
      [2, 9],
      [9, 2],
    ]) {
      expect(ids(reorderLabels(base, from, to))).toEqual([...LABEL_IDS]);
    }
  });

  it("leaves the default where it was — order and default are separate", () => {
    const next = reorderLabels(defaultLabels(), 0, 4);
    expect(defaultLabel(next).id).toBe("warn");
  });
});

describe("setDefaultLabel", () => {
  it("promotes one label and demotes the old default", () => {
    const next = setDefaultLabel(defaultLabels(), "error");
    expect(defaultLabel(next).id).toBe("error");
    expect(next.filter((l) => l.isDefault)).toHaveLength(1);
  });

  it("leaves the list unchanged for an unknown id", () => {
    const next = setDefaultLabel(defaultLabels(), "chartreuse");
    expect(defaultLabel(next).id).toBe("warn");
  });
});

describe("validateLabelName", () => {
  const labels = defaultLabels();

  it("accepts a trimmed new name", () => {
    expect(validateLabelName(labels, "ok", "  Peer review ")).toEqual({
      ok: true,
      value: "Peer review",
    });
  });

  it("accepts a label's own name unchanged", () => {
    expect(validateLabelName(labels, "ok", SHIPPED_NAMES.ok).ok).toBe(true);
  });

  it("rejects an empty name", () => {
    expect(validateLabelName(labels, "ok", "   ").ok).toBe(false);
  });

  it("rejects another label's name, case-insensitively", () => {
    expect(validateLabelName(labels, "ok", SHIPPED_NAMES.error).ok).toBe(false);
    expect(
      validateLabelName(labels, "ok", SHIPPED_NAMES.error.toUpperCase()).ok,
    ).toBe(false);
  });
});
