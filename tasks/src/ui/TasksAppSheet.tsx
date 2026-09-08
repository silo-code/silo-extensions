/**
 * The Tasks app — the same aggregated list as the Navigator view, in a
 * dock-anchored sheet with the room a ~250px side panel doesn't have. Opened by
 * `silo.tasks.open`; non-modal by construction (`openPanelSheet` paints no
 * scrim and leaves `Escape` to the content, where it pops a drill-in page).
 *
 * This is where a task from the Navigator is **read and edited**: the Navigator
 * hands off to the sheet rather than paging itself into a detail view. Opened
 * for a specific task, it lands on that task's page and `Back` returns to the
 * full aggregated list.
 *
 * The sheet is not inside the Navigator header, so it carries the arrange /
 * filter controls inline, like the side panel — but with prefixed labels
 * ("Status: Open") and its own persisted prefs (`view:sheet`), kept apart
 * from the Navigator view's (`view:cross`): the narrow rail and the wide
 * sheet are arranged differently.
 *
 * Its list page is the one place `TasksBody` renders `variant="rows"` with a
 * `composer` instead of `TaskList` + `QuickAdd` — the width to show every
 * task field per row and batch-edit several tasks at once (R9, reworked from
 * a `<table>` to multiline rows in R15). The panel and the Navigator view
 * stay the byte-identical row list.
 */

import type { ExtensionContext } from "@silo-code/sdk";
import { useServiceState } from "@silo-code/sdk";
import type { PrefsStore } from "../lib/prefs";
import type { SourceSet } from "../sources/source-set";
import { TasksBody } from "./TasksBody";
import type { PanelBridge } from "./panel-bridge";
import type { DrillState } from "./use-drill-in";

export function TasksAppSheet({
  ctx,
  sourceSet,
  prefsStore,
  bridge,
  initialTask = null,
  focusComposerOnMount = false,
  focusSearchOnMount = false,
}: {
  ctx: ExtensionContext;
  sourceSet: SourceSet;
  prefsStore: PrefsStore;
  /**
   * Lets an *already open* sheet be re-pointed at another task when a second
   * Navigator row is clicked, instead of stacking a second sheet.
   */
  bridge: PanelBridge;
  /** The task the sheet was opened for, if any. */
  initialTask?: DrillState;
  /** Opened from the Navigator's "New task" button — land in the composer. */
  focusComposerOnMount?: boolean;
  /** Opened from the Navigator's "Manage tasks" button — land in search. */
  focusSearchOnMount?: boolean;
}) {
  const state = useServiceState(sourceSet);
  return (
    <TasksBody
      ctx={ctx}
      sourceSet={sourceSet}
      prefsStore={prefsStore}
      sources={state.sources}
      bridge={bridge}
      initialTask={initialTask}
      initialFocusComposer={focusComposerOnMount}
      initialFocusSearch={focusSearchOnMount}
      className="tasks-sheet"
      variant="rows"
      composer
    />
  );
}
