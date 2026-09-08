/**
 * The Navigator's cross-workspace **Tasks** view — every open workspace's list
 * plus the personal one, in one place. Same body as the side panel, handed the
 * *whole* source set instead of a scoped slice.
 *
 * It is a **list only**. Picking a task opens it in the Tasks app sheet rather
 * than replacing the Navigator with a detail page: the Navigator is where you
 * navigate *from*, so paging it into a single task takes away the thing it is
 * for, in the narrowest column in the app. The sheet has the width to read a
 * task in, and leaves the list standing beside it.
 *
 * The sheet is anchored to `panelId` — the side panel hosting the Navigator,
 * handed to every view by the host — so it grows out of whichever column the
 * user has actually docked the Navigator in, not out of wherever the Tasks side
 * panel happens to be registered.
 *
 * Its arrange / filter controls are `"navigator"`-surface toolbar items in the
 * host's view header (ADR 0038 — one view, controls are toolbar items). The
 * body's own inline search box is hidden too (R13, `search={false}`) — the
 * toolbar's `silo.tasks.nav.openSheet` button is the way to reach real
 * search, alongside everything else the sheet's table has room for; a second,
 * narrower search box in this already-cramped list body was redundant.
 */

import type { ExtensionContext, NavigatorViewProps } from "@silo-code/sdk";
import { useServiceState } from "@silo-code/sdk";
import type { PrefsStore } from "../lib/prefs";
import type { SourceSet } from "../sources/source-set";
import { TasksBody } from "./TasksBody";

export function CrossTasksView({
  ctx,
  sourceSet,
  prefsStore,
  onOpenTask,
  panelId,
}: NavigatorViewProps & {
  ctx: ExtensionContext;
  sourceSet: SourceSet;
  prefsStore: PrefsStore;
  /**
   * Open this task in the Tasks app sheet, anchored to the panel hosting the
   * Navigator so the sheet grows out of the column the click came from.
   */
  onOpenTask: (
    sourceId: string,
    taskId: string,
    anchorPanelId: string | undefined,
  ) => void;
}) {
  const state = useServiceState(sourceSet);
  return (
    <TasksBody
      ctx={ctx}
      sourceSet={sourceSet}
      prefsStore={prefsStore}
      sources={state.sources}
      controls={false}
      search={false}
      onOpenTask={(sourceId, taskId) => onOpenTask(sourceId, taskId, panelId)}
      className="tasks-cross"
    />
  );
}
