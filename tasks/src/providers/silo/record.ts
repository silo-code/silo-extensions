/**
 * The Silo provider's **on-disk shape** and the record ⇄ core-model mapping.
 * Deliberately a *superset* of {@link Task}: the record is the product, the
 * core model is the lowest common denominator across providers.
 *
 * This file owns both directions — {@link toTask} and {@link toDetailSections}
 * — so the core/detail split lives in exactly one place, and everything the
 * record has that {@link Task} lacks is provably reachable only through
 * descriptors.
 */

import type { ChecklistItem, DetailSection } from "../../model/detail";
import {
  ALL_LANES,
  ALL_PRIORITIES,
  LANE_LABELS,
  type Task,
  type TaskLane,
  type TaskPriority,
} from "../../model/task";

/** The current schema version. A record with any other `v` routes to `unparsed`. */
export const SCHEMA_VERSION = 1 as const;

export interface SiloTaskRecord {
  v: typeof SCHEMA_VERSION;
  id: string;
  title: string;
  lane: TaskLane;
  priority: TaskPriority;
  rank: string;
  parentId?: string | null;
  labels?: string[];
  assignees?: string[];
  description?: string;
  acceptanceCriteria?: ChecklistItem[];
  /** ISO date (`YYYY-MM-DD`). */
  dueDate?: string;
  createdAt: number;
  updatedAt: number;
  closedAt?: number | null;
  /**
   * Any keys written by a newer Silo that this code doesn't model. Preserved
   * through a load/save round trip so an older Silo never strips them.
   */
  [extra: string]: unknown;
}

const LANE_SET = new Set<string>(ALL_LANES);
const PRIORITY_SET = new Set<string>(ALL_PRIORITIES);

/**
 * True when `value` is a record this code understands: an object with
 * `v === 1` and the required primitives well-formed. A higher `v`, a missing
 * `v`, or a malformed core field fails here and the line is kept verbatim in
 * {@link import("./jsonl").ParsedFile.unparsed}.
 */
export function isKnownRecordShape(value: unknown): value is SiloTaskRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    r.v === SCHEMA_VERSION &&
    typeof r.id === "string" &&
    r.id.length > 0 &&
    typeof r.title === "string" &&
    typeof r.lane === "string" &&
    LANE_SET.has(r.lane) &&
    typeof r.priority === "string" &&
    PRIORITY_SET.has(r.priority) &&
    typeof r.rank === "string" &&
    typeof r.createdAt === "number" &&
    typeof r.updatedAt === "number"
  );
}

export function toTask(record: SiloTaskRecord, sourceId: string): Task {
  return {
    id: record.id,
    sourceId,
    title: record.title,
    lane: record.lane,
    statusLabel: LANE_LABELS[record.lane],
    priority: record.priority,
    rank: record.rank,
    parentId: record.parentId ?? null,
    labels: record.labels ?? [],
    assignees: record.assignees ?? [],
    updatedAt: record.updatedAt,
  };
}

/** Patch keys the Silo provider recognizes. Opaque strings to the core. */
export const SILO_FIELD_KEYS = {
  description: "description",
  dueDate: "dueDate",
  acceptanceCriteria: "acceptanceCriteria",
} as const;

/**
 * The provider-rendered detail for one record. `created` is always present and
 * read-only. `description` / `dueDate` / `acceptanceCriteria` are always
 * emitted as **editable** sections (empty when the record doesn't have them
 * yet) — R10 requires them to be editable from the detail page, so their
 * editors must always be reachable. Fields the schema simply doesn't carry
 * (`parentId`, `assignees`, `closedAt`) produce no section.
 */
export function toDetailSections(record: SiloTaskRecord): DetailSection[] {
  return [
    {
      kind: "text",
      label: "Description",
      value: record.description ?? "",
      key: SILO_FIELD_KEYS.description,
      editable: true,
    },
    {
      kind: "field",
      label: "Due date",
      value: record.dueDate ?? "",
      format: "date",
      key: SILO_FIELD_KEYS.dueDate,
      editable: true,
    },
    {
      kind: "checklist",
      label: "Acceptance criteria",
      items: record.acceptanceCriteria ?? [],
      key: SILO_FIELD_KEYS.acceptanceCriteria,
      editable: true,
    },
    {
      kind: "field",
      label: "Created",
      value: new Date(record.createdAt).toISOString().slice(0, 10),
    },
  ];
}

/** Which detail-section keys are round-trippable back onto a record. */
export function sectionKeys(): string[] {
  return Object.values(SILO_FIELD_KEYS);
}

function coerceChecklist(value: unknown): ChecklistItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items: ChecklistItem[] = [];
  for (const raw of value) {
    if (typeof raw === "object" && raw !== null) {
      const o = raw as Record<string, unknown>;
      if (typeof o.text === "string") {
        items.push({ text: o.text, done: o.done === true });
      }
    }
  }
  return items;
}

/**
 * Apply core fields and a `providerFields` bag to a record, returning a new
 * record. Unknown `providerFields` keys are **ignored**, not rejected (R4) — a
 * newer UI can't fail a write against an older provider.
 */
export function applyPatch(
  record: SiloTaskRecord,
  patch: {
    title?: string;
    lane?: TaskLane;
    priority?: TaskPriority;
    labels?: readonly string[];
    providerFields?: Readonly<Record<string, unknown>>;
  },
  now: number = Date.now(),
): SiloTaskRecord {
  const next: SiloTaskRecord = { ...record };

  if (patch.title !== undefined) next.title = patch.title;
  if (patch.lane !== undefined) {
    next.lane = patch.lane;
    next.closedAt = patch.lane === "done" ? now : null;
  }
  if (patch.priority !== undefined) next.priority = patch.priority;
  if (patch.labels !== undefined) next.labels = [...patch.labels];

  const pf = patch.providerFields ?? {};
  if (SILO_FIELD_KEYS.description in pf) {
    const v = pf[SILO_FIELD_KEYS.description];
    next.description = typeof v === "string" && v !== "" ? v : undefined;
  }
  if (SILO_FIELD_KEYS.dueDate in pf) {
    const v = pf[SILO_FIELD_KEYS.dueDate];
    next.dueDate = typeof v === "string" && v !== "" ? v : undefined;
  }
  if (SILO_FIELD_KEYS.acceptanceCriteria in pf) {
    const items = coerceChecklist(pf[SILO_FIELD_KEYS.acceptanceCriteria]);
    next.acceptanceCriteria = items && items.length > 0 ? items : undefined;
  }

  next.updatedAt = now;
  return next;
}

/** Build a fresh record for a new task. */
export function newRecord(input: {
  id: string;
  title: string;
  rank: string;
  lane?: TaskLane;
  priority?: TaskPriority;
  labels?: readonly string[];
  providerFields?: Readonly<Record<string, unknown>>;
  now?: number;
}): SiloTaskRecord {
  const now = input.now ?? Date.now();
  const base: SiloTaskRecord = {
    v: SCHEMA_VERSION,
    id: input.id,
    title: input.title,
    lane: input.lane ?? "todo",
    priority: input.priority ?? "normal",
    rank: input.rank,
    labels: input.labels ? [...input.labels] : undefined,
    createdAt: now,
    updatedAt: now,
    closedAt: (input.lane ?? "todo") === "done" ? now : null,
  };
  return applyPatch(base, { providerFields: input.providerFields }, now);
}
