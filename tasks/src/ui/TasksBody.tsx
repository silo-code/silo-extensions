/**
 * The body every task surface renders — the side panel, the Navigator
 * cross-workspace view, and the Tasks app sheet. One component, one view
 * model: the surfaces differ only in **which sources** they are handed and
 * which chrome they own (inline controls, a quick-add dock).
 *
 * Keeping this single is R5's "no forked copy": a mutation from any surface
 * flows through the one `sourceSet` and every mounted surface re-renders.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExtensionContext, MenuEntry } from "@silo-code/sdk";
import { EmptyState, useServiceState } from "@silo-code/sdk";
import { WarningCircle } from "@phosphor-icons/react";
import type { DetailSection } from "../model/detail";
import type { TaskSource } from "../model/source";
import type { Task, TaskLane, TaskPatch, TaskPriority } from "../model/task";
import { buildView, collectLabels, DEFAULT_VIEW_PREFS } from "../lib/view";
import { focusWhenReady } from "../lib/focus";
import type { PrefsStore } from "../lib/prefs";
import type { SourceSet } from "../sources/source-set";
import { TasksToolbar } from "./TasksToolbar";
import { QuickAdd } from "./QuickAdd";
import { Composer, type ComposerDraft } from "./Composer";
import { TaskList } from "./TaskList";
import { TaskRows } from "./TaskRows";
import { BatchBar } from "./BatchBar";
import { TaskDetail } from "./TaskDetail";
import { useDrillIn, type DrillState } from "./use-drill-in";
import { useBatchSelection } from "./use-batch-selection";
import type { PanelBridge } from "./panel-bridge";

export interface TasksBodyProps {
  ctx: ExtensionContext;
  sourceSet: SourceSet;
  prefsStore: PrefsStore;
  /** The sources this surface shows — a scoped slice, or the whole set. */
  sources: readonly TaskSource[];
  /**
   * Render the arrange / filter dropdowns inline above the search box. The
   * Navigator view passes `false`: there the controls are `"navigator"`-surface
   * toolbar items in the host's own header (ADR 0038).
   */
  controls?: boolean;
  /**
   * Render the inline `SearchInput`. `false` for the Navigator view (R13) —
   * its own toolbar gained a button that opens the sheet instead, which has
   * the room for a real search box; a second, narrower one in the view body
   * was redundant with it.
   */
  search?: boolean;
  /** Render the quick-add dock. The side panel only — see `destination`. */
  quickAdd?: boolean;
  /**
   * Render the sheet's create row instead — title, priority, labels, and a
   * list picker `QuickAdd` deliberately doesn't have (R9). The sheet only;
   * mutually exclusive with `quickAdd`.
   */
  composer?: boolean;
  /**
   * `"rows"` renders `TaskRows` (multiline, with batch selection) instead of
   * `TaskList`. The sheet only — the panel and the Navigator view stay
   * `TaskRow`, byte-identical, per R5 (R9, reworked from a `<table>` to
   * multiline rows in R15).
   */
  variant?: "list" | "rows";
  /** Imperative hook-up for the commands. */
  bridge?: PanelBridge;
  /**
   * Where a row click goes. Omitted, the surface drills into its own detail
   * page. Supplied, the row **hands off** — the Navigator view is a list only
   * and opens the task in the Tasks app sheet, which has the width to read it.
   * A surface that hands off never renders a detail page of its own.
   */
  onOpenTask?: (sourceId: string, taskId: string) => void;
  /** Open straight onto this task's detail page (the sheet, opened for a row). */
  initialTask?: DrillState;
  /**
   * Expand the composer and focus its title input on mount — the sheet, opened
   * from the Navigator's "New task" button. Composer surface only.
   */
  initialFocusComposer?: boolean;
  /**
   * Focus the toolbar's search input on mount — the sheet, opened from the
   * Navigator's "Manage tasks" button.
   */
  initialFocusSearch?: boolean;
  /** Extra class on the root, for surface-specific chrome. */
  className?: string;
}

export function TasksBody({
  ctx,
  sourceSet,
  prefsStore,
  sources,
  controls = true,
  search = true,
  quickAdd = false,
  composer = false,
  variant = "list",
  bridge,
  onOpenTask,
  initialTask = null,
  initialFocusComposer = false,
  initialFocusSearch = false,
  className,
}: TasksBodyProps) {
  const state = useServiceState(sourceSet);
  const prefs = useServiceState(prefsStore);
  const ws = useServiceState(ctx.workspaces);
  const { open, drill, back } = useDrillIn(initialTask);
  const { picked, toggle: togglePicked, toggleAll: toggleAllPicked, clear: clearPicked } =
    useBatchSelection();

  const [sections, setSections] = useState<readonly DetailSection[]>([]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const quickAddRef = useRef<HTMLDivElement | null>(null);
  // Bumped to request focus into the quick-add input (from the `+` button, the
  // empty-state button, or the `silo.tasks.newInWorkspace` command with no title).
  const [focusSeed, setFocusSeed] = useState(0);
  // Same, for the sheet's composer — starts at 1 when the sheet was opened by
  // the Navigator's "New task" button so it focuses on mount.
  const [composerFocusSeed, setComposerFocusSeed] = useState(
    initialFocusComposer ? 1 : 0,
  );
  // Same, for the toolbar's search input (the "Manage tasks" button).
  const [searchFocusSeed, setSearchFocusSeed] = useState(
    initialFocusSearch ? 1 : 0,
  );

  const showMenu = useCallback(
    (items: MenuEntry[], anchor: HTMLElement) => {
      void ctx.ui.showMenu({ items, anchor });
    },
    [ctx],
  );

  const allTasks = useMemo(
    () => sources.flatMap((s) => state.tasksBySource.get(s.id) ?? []),
    [sources, state],
  );
  const labels = useMemo(() => collectLabels(allTasks), [allTasks]);
  // The rows variant (R10) drops grouping outright — the flat multiline list
  // has no group headers. `groupBy` is still a real persisted field on the
  // sheet's own prefs (a stale non-"none" value could survive from an earlier
  // build), so it is overridden here for this view's build. Sort / filter /
  // search still apply.
  const effectiveView = useMemo(
    () => (variant === "rows" ? { ...prefs.view, groupBy: "none" as const } : prefs.view),
    [variant, prefs.view],
  );
  const groups = useMemo(
    () => buildView(allTasks, sources, effectiveView),
    [allTasks, sources, effectiveView],
  );
  const totalVisible = groups.reduce((n, g) => n + g.tasks.length, 0);
  const visibleIds = useMemo(
    () => groups.flatMap((g) => g.tasks.map((t) => t.id)),
    [groups],
  );

  // Sources this surface shows that failed to load. One bad workspace never
  // blanks the rest of the list — it is named in a line above it.
  const failed = useMemo(
    () => sources.filter((s) => state.errorsBySource.has(s.id)),
    [sources, state],
  );

  const openTaskId = open?.taskId ?? null;
  const openSourceId = open?.sourceId ?? null;
  const openTask = openTaskId
    ? allTasks.find((t) => t.id === openTaskId) ?? null
    : null;
  const openSource = openSourceId
    ? sources.find((s) => s.id === openSourceId) ?? null
    : null;

  // Load provider detail sections for the drilled-into task.
  useEffect(() => {
    if (!openTaskId || !openSourceId) {
      setSections([]);
      return;
    }
    let live = true;
    void sourceSet
      .detail(openSourceId, openTaskId)
      .then((s) => {
        if (live) setSections(s);
      })
      .catch(() => {
        if (live) setSections([]);
      });
    return () => {
      live = false;
    };
  }, [sourceSet, openTaskId, openSourceId, state]);

  // Imperative bridge for the commands in index.ts. Only the surface that owns
  // the quick-add dock claims it, so two mounted surfaces can't fight over it.
  useEffect(() => {
    if (!bridge) return;
    // A hand-off surface has no detail page to drive.
    if (!onOpenTask) bridge.drillTo = (sourceId, taskId) => drill(sourceId, taskId);
    if (quickAdd) {
      bridge.focusQuickAdd = () => {
        back();
        setFocusSeed((n) => n + 1);
      };
    }
    if (composer) {
      bridge.focusComposer = () => {
        back();
        setComposerFocusSeed((n) => n + 1);
      };
    }
    if (search) {
      bridge.focusSearch = () => {
        back();
        setSearchFocusSeed((n) => n + 1);
      };
    }
    return () => {
      bridge.drillTo = null;
      bridge.focusQuickAdd = null;
      bridge.focusComposer = null;
      bridge.focusSearch = null;
    };
  }, [bridge, drill, back, quickAdd, composer, search, onOpenTask]);

  useEffect(() => {
    if (focusSeed === 0) return;
    quickAddRef.current?.querySelector("input")?.focus();
  }, [focusSeed]);
  useEffect(() => {
    if (searchFocusSeed === 0) return;
    return focusWhenReady(() =>
      rootRef.current?.querySelector<HTMLInputElement>(".tasks-toolbar input"),
    );
  }, [searchFocusSeed]);

  // The quick-add always creates in the active workspace's source — the
  // unnamed global list when no workspace is open.
  const destination = sourceSet.resolveDestination("workspace");

  const create = useCallback(
    (title: string) => {
      if (!destination) return;
      ctx.log.info(`create task "${title}" in ${destination.name}`);
      void sourceSet.createTask(destination.id, { title }).catch((err) => {
        ctx.log.error("create task failed", err);
        ctx.ui.notify("error", `Couldn't create the task: ${String(err)}`);
      });
    },
    [sourceSet, ctx, destination],
  );

  const patch = useCallback(
    (p: TaskPatch) => {
      if (!openTask || !openSourceId) return;
      void sourceSet
        .updateTask(openSourceId, openTask.id, p)
        .catch((err) =>
          ctx.ui.notify("error", `Couldn't save the task: ${String(err)}`),
        );
    },
    [sourceSet, ctx, openTask, openSourceId],
  );

  const complete = useCallback(() => {
    if (!openTask || !openSourceId) return;
    void sourceSet
      .setLane(openSourceId, openTask.id, "done")
      .catch((err) =>
        ctx.ui.notify("error", `Couldn't complete the task: ${String(err)}`),
      );
  }, [sourceSet, ctx, openTask, openSourceId]);

  const remove = useCallback(() => {
    if (!openTask || !openSourceId) return;
    void (async () => {
      const ok = await ctx.ui.confirm({
        title: "Delete this task?",
        body: `"${openTask.title}" will be removed from the list.`,
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      try {
        await sourceSet.deleteTask(openSourceId, openTask.id);
        back();
      } catch (err) {
        ctx.ui.notify("error", `Couldn't delete the task: ${String(err)}`);
      }
    })();
  }, [sourceSet, ctx, openTask, openSourceId, back]);

  // Batch selection is the rows variant only, but starts fresh each time the
  // drilled-into task changes or a filter/search prefs change what's
  // visible — a picked id no longer on screen would otherwise sit invisibly
  // in the count. Deliberately narrower than "any view-prefs change": sortBy
  // / sortDir / groupBy / collapsedGroups reorder or redraw the same visible
  // set rather than change it, and clearing picked rows every time the sort
  // menu is used (R12, moved from column headers to a toolbar dropdown in
  // R15) would make batch selection unusable alongside sorting.
  const filterSignature = [
    prefs.view.query,
    prefs.view.laneFilter.join(","),
    prefs.view.labelFilter.join(","),
    prefs.view.sourceFilter.join(","),
  ].join("|");
  useEffect(() => {
    if (openTaskId) clearPicked();
  }, [openTaskId, clearPicked]);
  useEffect(() => {
    clearPicked();
  }, [filterSignature, clearPicked]);

  const setLaneMany = useCallback(
    (lane: TaskLane) => {
      const targets = allTasks.filter((t) => picked.has(t.id));
      void Promise.all(
        targets.map((t) => sourceSet.setLane(t.sourceId, t.id, lane)),
      ).catch((err) =>
        ctx.ui.notify("error", `Couldn't update status: ${String(err)}`),
      );
    },
    [allTasks, picked, sourceSet, ctx],
  );

  const setPriorityMany = useCallback(
    (priority: TaskPriority) => {
      const targets = allTasks.filter((t) => picked.has(t.id));
      void Promise.all(
        targets.map((t) =>
          sourceSet.updateTask(t.sourceId, t.id, { priority }),
        ),
      ).catch((err) =>
        ctx.ui.notify("error", `Couldn't update priority: ${String(err)}`),
      );
    },
    [allTasks, picked, sourceSet, ctx],
  );

  const addLabelMany = useCallback(
    (label: string) => {
      const targets = allTasks.filter((t) => picked.has(t.id));
      void Promise.all(
        targets.map((t) =>
          t.labels.includes(label)
            ? undefined
            : sourceSet.updateTask(t.sourceId, t.id, {
                labels: [...t.labels, label],
              }),
        ),
      ).catch((err) =>
        ctx.ui.notify("error", `Couldn't add the label: ${String(err)}`),
      );
    },
    [allTasks, picked, sourceSet, ctx],
  );

  const deleteMany = useCallback(() => {
    const targets = allTasks.filter((t) => picked.has(t.id));
    if (targets.length === 0) return;
    void (async () => {
      const ok = await ctx.ui.confirm({
        title:
          targets.length === 1
            ? "Delete this task?"
            : `Delete ${targets.length} tasks?`,
        body:
          targets.length === 1
            ? `"${targets[0].title}" will be removed from the list.`
            : `${targets.length} tasks will be removed from their lists.`,
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      try {
        await Promise.all(
          targets.map((t) => sourceSet.deleteTask(t.sourceId, t.id)),
        );
        clearPicked();
      } catch (err) {
        ctx.ui.notify("error", `Couldn't delete the tasks: ${String(err)}`);
      }
    })();
  }, [allTasks, picked, sourceSet, ctx, clearPicked]);

  const createFrom = useCallback(
    (sourceId: string, draft: ComposerDraft) => {
      ctx.log.info(`create task "${draft.title}" in ${sourceId}`);
      void sourceSet.createTask(sourceId, draft).catch((err) => {
        ctx.log.error("create task failed", err);
        ctx.ui.notify("error", `Couldn't create the task: ${String(err)}`);
      });
    },
    [sourceSet, ctx],
  );

  const root = ["tasks-panel", className].filter(Boolean).join(" ");

  if (state.error) {
    return (
      <div className={root}>
        <EmptyState
          tone="neutral"
          icon={<WarningCircle size={28} />}
          title="Task storage is unavailable"
          description={state.error}
        />
      </div>
    );
  }

  if (openTask && openSource) {
    const wsName =
      openSource.scope === "workspace"
        ? ws.all.find((w) => w.id === openSource.workspaceId)?.name
        : undefined;
    return (
      <div className={root}>
        <TaskDetail
          task={openTask}
          source={openSource}
          workspaceName={wsName}
          sections={sections}
          onBack={back}
          onPatch={patch}
          onComplete={complete}
          onDelete={remove}
        />
      </div>
    );
  }

  const filtered =
    prefs.view.query.trim() !== "" ||
    prefs.view.labelFilter.length > 0 ||
    JSON.stringify([...prefs.view.laneFilter].sort()) !==
      JSON.stringify([...DEFAULT_VIEW_PREFS.laneFilter].sort());
  const onOpen = (task: Task) =>
    onOpenTask
      ? onOpenTask(task.sourceId, task.id)
      : drill(task.sourceId, task.id);
  const onToggleGroup = (key: string) =>
    prefsStore.setView({
      ...prefs.view,
      collapsedGroups: {
        ...prefs.view.collapsedGroups,
        [key]: !prefs.view.collapsedGroups[key],
      },
    });
  const onClearFilters = () =>
    prefsStore.setView({
      ...prefs.view,
      query: "",
      labelFilter: [],
      laneFilter: DEFAULT_VIEW_PREFS.laneFilter,
    });
  const allPicked =
    visibleIds.length > 0 && visibleIds.every((id) => picked.has(id));

  return (
    <div className={root} ref={rootRef}>
      <TasksToolbar
        controls={controls}
        search={search}
        variant={variant}
        prefs={prefs.view}
        labels={labels}
        sources={sources}
        handlers={{
          showMenu,
          onView: (next) => prefsStore.setView({ ...prefs.view, ...next }),
          onRefresh: () => void sourceSet.refresh(),
        }}
      />
      {variant === "rows" && (
        <BatchBar
          count={picked.size}
          totalVisible={totalVisible}
          allPicked={allPicked}
          showMenu={showMenu}
          onSetLane={setLaneMany}
          onSetPriority={setPriorityMany}
          onAddLabel={addLabelMany}
          onDelete={deleteMany}
          onToggleAll={() => toggleAllPicked(visibleIds)}
          onClear={clearPicked}
        />
      )}
      <div className="tasks-panel-body silo-scroll">
        {failed.length > 0 && (
          <div className="tasks-source-error" role="status">
            Couldn&rsquo;t read tasks from {failed.map((s) => s.name).join(", ")}.
          </div>
        )}
        {variant === "rows" ? (
          <TaskRows
            groups={groups}
            totalVisible={totalVisible}
            hasAnyTask={allTasks.length > 0}
            filtered={filtered}
            openTaskId={openTaskId}
            picked={picked}
            sources={sources}
            onOpen={onOpen}
            onTogglePick={togglePicked}
            onClearFilters={onClearFilters}
          />
        ) : (
          <TaskList
            groups={groups}
            totalVisible={totalVisible}
            hasAnyTask={allTasks.length > 0}
            filtered={filtered}
            collapsedGroups={prefs.view.collapsedGroups}
            openTaskId={openTaskId}
            sources={sources}
            onOpen={onOpen}
            onToggleGroup={onToggleGroup}
            onClearFilters={onClearFilters}
          />
        )}
      </div>
      {quickAdd && (
        <div className="tasks-quickadd-dock" ref={quickAddRef}>
          <QuickAdd
            destinationName={destination?.name}
            canSubmit={destination != null}
            onCreate={create}
            onNoDestination={() =>
              ctx.ui.notify(
                "warn",
                state.loading
                  ? "Task lists are still loading — try again in a moment."
                  : "No task list is available to add to.",
              )
            }
          />
        </div>
      )}
      {composer && (
        <div className="tasks-composer-dock">
          <Composer
            sources={sources}
            canSubmit={sources.length > 0}
            showMenu={showMenu}
            focusSignal={composerFocusSeed}
            onCreate={createFrom}
            onNoDestination={() =>
              ctx.ui.notify(
                "warn",
                state.loading
                  ? "Task lists are still loading — try again in a moment."
                  : "No task list is available to add to.",
              )
            }
          />
        </div>
      )}
    </div>
  );
}
