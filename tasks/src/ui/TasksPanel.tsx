/**
 * The side panel: {@link TasksBody} over the **scoped** slice of the source set
 * — the global list plus the active workspace's — with the quick-add dock and
 * the inline toolbar controls. Everything else (grouping, drill-in, mutations)
 * is the shared body; the panel only decides scope and chrome.
 */

import { useEffect, useMemo } from "react";
import type { ExtensionContext, SidePanelProps } from "@silo-code/sdk";
import { useServiceState } from "@silo-code/sdk";
import type { PrefsStore } from "../lib/prefs";
import { selectScopedSources, type SourceSet } from "../sources/source-set";
import { TasksBody } from "./TasksBody";
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
  const ws = useServiceState(ctx.workspaces);

  useEffect(() => {
    prefsStore.setHydrated(hydrated);
  }, [prefsStore, hydrated]);

  useEffect(() => {
    prefsStore.setWorkspace(ws.activeId);
  }, [prefsStore, ws.activeId]);

  const sources = useMemo(
    () => selectScopedSources(state.sources, ws.activeId),
    [state.sources, ws.activeId],
  );

  return (
    <TasksBody
      ctx={ctx}
      sourceSet={sourceSet}
      prefsStore={prefsStore}
      sources={sources}
      bridge={bridge}
      quickAdd
    />
  );
}
