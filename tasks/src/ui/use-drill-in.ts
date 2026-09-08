/**
 * The drill-in page state shared by all three task surfaces (side panel,
 * Navigator cross-workspace view, Tasks app sheet). One page at a time —
 * detail *replaces* the list, it doesn't nest — so the state is a single
 * open page or nothing, and `Escape` pops that one page and never closes the
 * surface it lives in.
 *
 * The reducer is exported separately so the rules are unit-testable without
 * rendering anything.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { yieldEscapeToInlineEdit } from "@silo-code/sdk";

/** The open detail page, or `null` on the list page. */
export type DrillState = { sourceId: string; taskId: string } | null;

export type DrillAction =
  | { type: "open"; sourceId: string; taskId: string }
  | { type: "back" };

/**
 * Pure page-stack rules. "Back" from the list page is a no-op — there is
 * nothing above the list, and popping past it must never be read as "close the
 * panel".
 */
export function drillReducer(state: DrillState, action: DrillAction): DrillState {
  switch (action.type) {
    case "open":
      return { sourceId: action.sourceId, taskId: action.taskId };
    case "back":
      return null;
  }
}

export interface DrillIn {
  /** The open detail page, or `null` on the list page. */
  open: DrillState;
  drill(sourceId: string, taskId: string): void;
  back(): void;
}

/**
 * `Escape` is captured only while a detail page is open, so the surface's own
 * Escape handling (or lack of it) is untouched on the list page. An
 * in-progress `InlineEdit` / `LabelsField` edit takes the first Escape.
 *
 * `initial` opens straight onto a detail page — the Tasks app sheet uses it
 * when it is opened *for* a task picked in the Navigator.
 */
export function useDrillIn(initial: DrillState = null): DrillIn {
  const [open, setOpen] = useState<DrillState>(initial);

  const dispatch = useCallback(
    (action: DrillAction) => setOpen((s) => drillReducer(s, action)),
    [],
  );
  const drill = useCallback(
    (sourceId: string, taskId: string) =>
      dispatch({ type: "open", sourceId, taskId }),
    [dispatch],
  );
  const back = useCallback(() => dispatch({ type: "back" }), [dispatch]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (yieldEscapeToInlineEdit()) return;
      back();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, back]);

  return useMemo(() => ({ open, drill, back }), [open, drill, back]);
}
