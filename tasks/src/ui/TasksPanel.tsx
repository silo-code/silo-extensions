/**
 * The panel root. One piece of local state — `openTaskId` — decides list page
 * vs. detail page (replace, not nest). `Escape` pops one page. Nothing here is
 * persisted; everything else is either the reactive source-set state or the
 * persisted prefs.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ExtensionContext,
  MenuEntry,
  SidePanelProps,
} from "@silo-code/sdk";
import {
  EmptyState,
  useServiceState,
  yieldEscapeToInlineEdit,
} from "@silo-code/sdk";
import { WarningCircle } from "@phosphor-icons/react";
import type { DetailSection } from "../model/detail";
import type { Task, TaskPatch } from "../model/task";
import { buildView, collectLabels, DEFAULT_VIEW_PREFS } from "../lib/view";
import type { PrefsStore } from "../lib/prefs";
import type { SourceSet } from "../sources/source-set";
import { TasksToolbar } from "./TasksToolbar";
import { QuickAdd } from "./QuickAdd";
import { TaskList } from "./TaskList";
import { TaskDetail } from "./TaskDetail";
import type { PanelBridge } from "./panel-bridge";

export function TasksPanel({
  ctx,
  sourceSet,
  prefsStore,
  bridge,
  hydrated,
}: SidePanelProps & {
  ctx: ExtensionContext;
  sourceSet: SourceSet;
  prefsStore: PrefsStore;
  bridge: PanelBridge;
}) {
  const state = useServiceState(sourceSet);
  const prefs = useServiceState(prefsStore);
  const ws = useServiceState(ctx.workspaces);

  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [openSourceId, setOpenSourceId] = useState<string | null>(null);
  const [sections, setSections] = useState<readonly DetailSection[]>([]);
  const quickAddRef = useRef<HTMLDivElement | null>(null);
  // Bumped to request focus into the quick-add input (from the `+` button, the
  // empty-state button, or the `silo.tasks.new` command with no title).
  const [focusSeed, setFocusSeed] = useState(0);

  useEffect(() => {
    prefsStore.setHydrated(hydrated);
  }, [prefsStore, hydrated]);

  useEffect(() => {
    prefsStore.setWorkspace(ws.activeId);
  }, [prefsStore, ws.activeId]);

  const showMenu = useCallback(
    (items: MenuEntry[], anchor: HTMLElement) => {
      void ctx.ui.showMenu({ items, anchor });
    },
    [ctx],
  );

  const allTasks = useMemo(
    () => state.sources.flatMap((s) => state.tasksBySource.get(s.id) ?? []),
    [state],
  );
  const labels = useMemo(() => collectLabels(allTasks), [allTasks]);
  const groups = useMemo(
    () => buildView(allTasks, state.sources, prefs.view),
    [allTasks, state.sources, prefs.view],
  );
  const totalVisible = groups.reduce((n, g) => n + g.tasks.length, 0);

  const openTask = openTaskId
    ? allTasks.find((t) => t.id === openTaskId) ?? null
    : null;
  const openSource = openSourceId
    ? state.sources.find((s) => s.id === openSourceId) ?? null
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

  const drill = useCallback((sourceId: string, taskId: string) => {
    setOpenSourceId(sourceId);
    setOpenTaskId(taskId);
  }, []);
  const back = useCallback(() => {
    setOpenTaskId(null);
    setOpenSourceId(null);
  }, []);

  // Escape pops one page — never closes the panel. An in-progress InlineEdit /
  // LabelsField edit takes the first Escape (cancel the edit, stay on the page).
  useEffect(() => {
    if (!openTaskId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (yieldEscapeToInlineEdit()) return;
      back();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [openTaskId, back]);

  // Imperative bridge for the commands in index.ts.
  useEffect(() => {
    bridge.focusQuickAdd = () => {
      setOpenTaskId(null);
      setOpenSourceId(null);
      setFocusSeed((n) => n + 1);
    };
    bridge.drillTo = (sourceId, taskId) => drill(sourceId, taskId);
    return () => {
      bridge.focusQuickAdd = null;
      bridge.drillTo = null;
    };
  }, [bridge, drill]);
  useEffect(() => {
    bridge.drilledTaskId = openTaskId;
    bridge.drilledSourceId = openSourceId;
  }, [bridge, openTaskId, openSourceId]);

  useEffect(() => {
    if (focusSeed === 0) return;
    quickAddRef.current?.querySelector("input")?.focus();
  }, [focusSeed]);

  // The side panel always creates in the active workspace's source — the global
  // ("Personal") list when no workspace is open.
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

  if (state.error) {
    return (
      <div className="tasks-panel">
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
      <div className="tasks-panel">
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

  return (
    <div className="tasks-panel">
      <TasksToolbar
        prefs={prefs.view}
        labels={labels}
        handlers={{
          showMenu,
          onView: (next) => prefsStore.setView({ ...prefs.view, ...next }),
          onRefresh: () => void sourceSet.refresh(),
        }}
      />
      <div className="tasks-panel-body silo-scroll">
        <TaskList
          groups={groups}
          totalVisible={totalVisible}
          hasAnyTask={allTasks.length > 0}
          filtered={
            prefs.view.query.trim() !== "" ||
            prefs.view.labelFilter.length > 0 ||
            JSON.stringify([...prefs.view.laneFilter].sort()) !==
              JSON.stringify([...DEFAULT_VIEW_PREFS.laneFilter].sort())
          }
          collapsedGroups={prefs.view.collapsedGroups}
          openTaskId={openTaskId}
          onOpen={(task) => drill(task.sourceId, task.id)}
          onToggleGroup={(key) =>
            prefsStore.setView({
              ...prefs.view,
              collapsedGroups: {
                ...prefs.view.collapsedGroups,
                [key]: !prefs.view.collapsedGroups[key],
              },
            })
          }
          onClearFilters={() =>
            prefsStore.setView({
              ...prefs.view,
              query: "",
              labelFilter: [],
              laneFilter: DEFAULT_VIEW_PREFS.laneFilter,
            })
          }
        />
      </div>
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
    </div>
  );
}
