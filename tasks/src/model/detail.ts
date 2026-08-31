/**
 * The **descriptor channel** — how a provider surfaces detail the core model
 * doesn't carry, as plain serializable data the core renders generically.
 *
 * No React, no functions: a `DetailSection[]` is directly assertable in a test
 * and can't smuggle provider-specific rendering into the core. `DetailSections`
 * (the renderer) switches on `kind` and returns `null` for anything it doesn't
 * recognize, so a provider built against a newer descriptor set degrades to
 * "section missing" rather than a crashed panel.
 */

/**
 * Present when a section is round-trippable. `key` is the patch key an edit to
 * this section writes into ({@link import("./task").TaskPatch.providerFields});
 * `editable` opts the section into an editor. A section with a `key` but no
 * `editable` (or vice versa) renders read-only.
 */
export interface Editable {
  key?: string;
  editable?: boolean;
}

/** One checklist item, e.g. an acceptance-criterion line. */
export interface ChecklistItem {
  text: string;
  done: boolean;
}

export type DetailSection =
  | ({ kind: "text"; label?: string; value: string } & Editable)
  | ({
      kind: "field";
      label: string;
      value: string;
      /**
       * How an editable `field` renders its input. `"date"` gives a native
       * `<input type="date">` (design-token styled); omitted / `"text"` gives a
       * single-line text input. Display-only for a read-only section.
       */
      format?: "text" | "date";
    } & Editable)
  | ({
      kind: "checklist";
      label: string;
      items: readonly ChecklistItem[];
    } & Editable);

/** True when a section should be rendered with an editor rather than read-only. */
export function isEditableSection(
  section: DetailSection,
): section is DetailSection & { key: string; editable: true } {
  return section.editable === true && typeof section.key === "string";
}
