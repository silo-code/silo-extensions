/**
 * The five follow-up labels — one per host semantic color.
 *
 * The label list is **fixed at five**, and a label's id *is* its color. The
 * host's whole-tab highlight accepts only a `TabAdornmentColor`
 * (`"accent" | "info" | "warn" | "ok" | "error" | "muted"`), and those resolve to
 * theme-overridable tokens, so they track whatever preset the user is on. A
 * larger palette would mean hardcoded hex that ignores the theme and can't
 * drive the tint — so users rename / reorder / pick the default, but cannot
 * add or delete. That is also why the persisted record stores only a label
 * id: the color is a code constant, not user data.
 *
 * `"accent"` used to be the fifth. It resolved to a near-gray in the shipped
 * dark theme, which left two of the five (it and `"muted"`) nearly
 * indistinguishable on a tab, and its shipped name — "Waiting on agent" —
 * described something the agent owns rather than something the user flagged.
 * The host's newer `"info"` slot is a themeable blue, so the fifth label is
 * now "In progress". {@link LEGACY_LABEL_IDS} carries anything already saved
 * under the old id across, and {@link RETIRED_SHIPPED_NAMES} makes sure the
 * old name isn't what carries.
 *
 * Pure — `import type` only, so the unit tests never load the SDK runtime.
 */

import type { InlineEditValidation, TabAdornmentColor } from "@silo-code/sdk";

/**
 * A label's stable identity, which is also its semantic color.
 *
 * `Extract` rather than a bare literal union, so the five are provably a
 * subset of the colors the host's tab tint accepts: rename or drop one on the
 * host side and this resolves to `never`, failing the build here instead of
 * silently painting nothing. It is a strict subset — `"accent"` is still a
 * valid tint color, it just isn't a follow-up label any more.
 */
export type LabelId = Extract<
  TabAdornmentColor,
  "warn" | "ok" | "error" | "info" | "muted"
>;

/** Every label id, in the order the five ship in. */
export const LABEL_IDS: readonly LabelId[] = [
  "warn",
  "ok",
  "error",
  "info",
  "muted",
];

/**
 * Ids this build no longer has, and what each becomes on read. Tabs flagged
 * with the old id keep their marks, and a user who *renamed* it keeps that
 * name; only the color moves. The old shipped name itself does not carry —
 * see {@link RETIRED_SHIPPED_NAMES}. Applied wherever a persisted id is read:
 * {@link coerceLabels} here, and `parseMarks` in `lib/store.ts`.
 */
export const LEGACY_LABEL_IDS: Readonly<Record<string, LabelId>> = {
  accent: "info",
};

/** A persisted id as this build knows it, or `null` if it's unknown garbage. */
export function migrateLabelId(raw: unknown): LabelId | null {
  if (typeof raw !== "string") return null;
  if (isLabelId(raw)) return raw;
  return LEGACY_LABEL_IDS[raw] ?? null;
}

/**
 * Names this build used to ship for a label, keyed by its *current* id.
 *
 * `setLabels` persists every name, not just renamed ones, so a user who never
 * touched the blue label still has `"Waiting on agent"` in storage. Carrying
 * that across would mean the rename in {@link SHIPPED_NAMES} never reaches
 * anyone who had the extension installed before. A stored name matching one
 * of these is therefore read as *no name* — the old default, not a rename —
 * and falls back to the current shipped name.
 *
 * The cost is that a user can't deliberately rename a label back to a retired
 * default: it resets on the next read. That's the right trade for one string
 * nobody picks on purpose.
 */
export const RETIRED_SHIPPED_NAMES: Partial<Record<LabelId, string>> = {
  info: "Waiting on agent",
};

/** The shipped name for each label — the fallback when a stored name is missing. */
export const SHIPPED_NAMES: Readonly<Record<LabelId, string>> = {
  warn: "Need more info",
  ok: "Needs review",
  error: "Blocked",
  info: "In progress",
  muted: "Read later",
};

/** The label that is the default when nothing is persisted. */
export const SHIPPED_DEFAULT_ID: LabelId = "warn";

/** One label, as the user has it configured. */
export interface FollowUpLabel {
  readonly id: LabelId;
  /** User-editable display name. Never empty. */
  readonly name: string;
  /** Exactly one label in a list is the default. */
  readonly isDefault: boolean;
}

/** Persisted per-label shape under `ctx.storage.global` key `"labels"`. */
export interface StoredLabel {
  id: string;
  name?: string;
  isDefault?: boolean;
}

const LABEL_ID_SET = new Set<string>(LABEL_IDS);

function isLabelId(v: unknown): v is LabelId {
  return typeof v === "string" && LABEL_ID_SET.has(v);
}

/** The shipped five, in shipped order, `warn` default. */
export function defaultLabels(): FollowUpLabel[] {
  return LABEL_IDS.map((id) => ({
    id,
    name: SHIPPED_NAMES[id],
    isDefault: id === SHIPPED_DEFAULT_ID,
  }));
}

/**
 * Read the persisted label list, guaranteeing the three invariants every
 * consumer relies on: **exactly five** labels (one per id), every name
 * non-empty, and **exactly one** default.
 *
 * Garbage tolerated by construction rather than by validation: an unknown id
 * is ignored, a missing/blank name falls back to its shipped name, zero
 * defaults promotes the first entry, and two defaults keeps the first. A
 * stored order is honored for the ids it names; ids it omits keep their
 * shipped relative order at the end.
 */
export function coerceLabels(raw: unknown): FollowUpLabel[] {
  const stored = Array.isArray(raw) ? raw : [];
  const byId = new Map<LabelId, { name?: string; isDefault?: boolean }>();
  const order: LabelId[] = [];
  for (const entry of stored) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as StoredLabel;
    const id = migrateLabelId(e.id);
    if (id === null || byId.has(id)) continue;
    byId.set(id, {
      name: typeof e.name === "string" ? e.name : undefined,
      isDefault: e.isDefault === true,
    });
    order.push(id);
  }
  // Ids the stored order never named land at the end in shipped order, so a
  // bag written by an older build (or a hand-edited one) still yields five.
  for (const id of LABEL_IDS) if (!byId.has(id)) order.push(id);

  const labels = order.map((id) => {
    const stored = byId.get(id)?.name?.trim();
    // A retired shipped name is the old default rather than a rename — see
    // RETIRED_SHIPPED_NAMES — so it reads as absent.
    const name = stored === RETIRED_SHIPPED_NAMES[id] ? undefined : stored;
    return {
      id,
      name: name && name.length > 0 ? name : SHIPPED_NAMES[id],
      isDefault: byId.get(id)?.isDefault === true,
    };
  });

  // Exactly one default: first wins when several claim it, and the first
  // label is promoted when none does.
  const firstDefault = labels.findIndex((l) => l.isDefault);
  const winner = firstDefault === -1 ? 0 : firstDefault;
  return labels.map((l, i) => ({ ...l, isDefault: i === winner }));
}

/** The list's default label. Never null — {@link coerceLabels} guarantees one. */
export function defaultLabel(labels: readonly FollowUpLabel[]): FollowUpLabel {
  return labels.find((l) => l.isDefault) ?? labels[0];
}

/**
 * The label a stored `labelId` names, falling back to the default. An unknown
 * id is not an error: there is one label per color, so the color *is* the
 * identity, and anything else is a value this build doesn't know.
 */
export function labelById(
  labels: readonly FollowUpLabel[],
  labelId: string,
): FollowUpLabel {
  return labels.find((l) => l.id === labelId) ?? defaultLabel(labels);
}

/**
 * The tint color for a label id — the identity mapping, since the id *is* the
 * color. Resolved through {@link labelById} so an id this build doesn't know
 * paints the default's color rather than nothing.
 */
export function labelColor(
  labels: readonly FollowUpLabel[],
  labelId: string,
): LabelId {
  return labelById(labels, labelId).id;
}

/** Rename one label. Returns the same array identity when nothing changed. */
export function renameLabel(
  labels: readonly FollowUpLabel[],
  labelId: string,
  name: string,
): FollowUpLabel[] {
  const trimmed = name.trim();
  if (trimmed.length === 0) return [...labels];
  return labels.map((l) => (l.id === labelId ? { ...l, name: trimmed } : l));
}

/** Move the label at `from` to `to`. Out-of-range indices are a no-op. */
export function reorderLabels(
  labels: readonly FollowUpLabel[],
  from: number,
  to: number,
): FollowUpLabel[] {
  const next = [...labels];
  if (
    from < 0 ||
    to < 0 ||
    from >= next.length ||
    to >= next.length ||
    from === to
  ) {
    return next;
  }
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Promote one label to default. An unknown id leaves the list unchanged. */
export function setDefaultLabel(
  labels: readonly FollowUpLabel[],
  labelId: string,
): FollowUpLabel[] {
  if (!labels.some((l) => l.id === labelId)) return [...labels];
  return labels.map((l) => ({ ...l, isDefault: l.id === labelId }));
}

/**
 * `InlineEdit` validator for a label rename: non-empty, and not already some
 * *other* label's name (five identically-named rows would make the dropdown
 * unusable).
 */
export function validateLabelName(
  labels: readonly FollowUpLabel[],
  labelId: string,
  raw: string,
): InlineEditValidation {
  const value = raw.trim();
  if (value.length === 0) return { ok: false, error: "Name can't be empty." };
  const clash = labels.some(
    (l) => l.id !== labelId && l.name.toLowerCase() === value.toLowerCase(),
  );
  if (clash) return { ok: false, error: "Another label already has that name." };
  return { ok: true, value };
}
