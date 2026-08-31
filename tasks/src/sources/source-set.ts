/**
 * The one stateful object in the extension. Resolves the live sources —
 * always the global one, plus the active workspace's when a workspace is open
 * — owns a watch per source, and exposes the {@link ReactiveService} shape so
 * the panel reads it with `useServiceState`.
 *
 * Because the source set is created once in `activate` and owned by the
 * extension (not the panel), lazily mounting or unmounting the panel neither
 * reloads nor drops a watch — R2's "loaded once, not per consumer".
 *
 * `globalDir()` is resolved once and cached; `workspaceDir()` is re-resolved
 * on every workspace change (the SDK documents that its path changes with the
 * active workspace). Only `NoWorkspaceError` maps to "no workspace source";
 * any other rejection is a genuine storage fault and surfaces.
 */

import type { ExtensionContext, ReactiveService } from "@silo-code/sdk";
import { NoWorkspaceError, path } from "@silo-code/sdk";
import type { Task, TaskDraft, TaskLane, TaskPatch } from "../model/task";
import type { DetailSection } from "../model/detail";
import { hashLocator, type TaskProvider, type TaskSource } from "../model/source";
import type { ProviderRegistry } from "../providers/registry";

const TASKS_FILE = "tasks.jsonl";
const SILO_PROVIDER_ID = "silo";
const GLOBAL_SOURCE_NAME = "Personal";

export interface SourceSetState {
  readonly sources: readonly TaskSource[];
  readonly tasksBySource: ReadonlyMap<string, readonly Task[]>;
  readonly loading: boolean;
  /** A storage fault (e.g. `globalDir()` rejected). `null` when healthy. */
  readonly error: string | null;
}

const EMPTY_STATE: SourceSetState = {
  sources: [],
  tasksBySource: new Map(),
  loading: true,
  error: null,
};

type Ctx = Pick<ExtensionContext, "workspaces" | "storage" | "log">;

export interface SourceSet extends ReactiveService<SourceSetState> {
  /** Resolve sources and load every list. Call once from `activate`. */
  start(): Promise<void>;
  /** Reload every resolved source's list (`silo.tasks.refresh` / manual). */
  refresh(): Promise<void>;
  detail(sourceId: string, taskId: string): Promise<readonly DetailSection[]>;
  createTask(sourceId: string, draft: TaskDraft): Promise<Task>;
  updateTask(sourceId: string, taskId: string, patch: TaskPatch): Promise<Task>;
  setLane(sourceId: string, taskId: string, lane: TaskLane): Promise<Task>;
  deleteTask(sourceId: string, taskId: string): Promise<void>;
  /** The source new tasks go to, honoring the pref and falling back to global. */
  resolveDestination(pref: "workspace" | "global"): TaskSource | undefined;
  /** Find which resolved source currently holds `taskId`, if any. */
  locate(taskId: string): { source: TaskSource; task: Task } | undefined;
  dispose(): void;
}

export function createSourceSet(
  ctx: Ctx,
  providers: ProviderRegistry,
): SourceSet {
  let state: SourceSetState = EMPTY_STATE;
  let signature = "";
  let sources: readonly TaskSource[] = [];
  let globalDir: string | null = null;
  let disposed = false;

  const listeners = new Set<(s: SourceSetState) => void>();
  const watches = new Map<string, { dispose(): void }>();
  const tasks = new Map<string, readonly Task[]>();

  function provider(): TaskProvider {
    const p = providers.get(SILO_PROVIDER_ID);
    if (!p) throw new Error("silo task provider not registered");
    return p;
  }

  function commit(loading: boolean, error: string | null): void {
    const tasksBySource = new Map(tasks);
    const sig = JSON.stringify({
      s: sources.map((s) => `${s.id}:${s.name}`),
      t: sources.map((s) =>
        (tasksBySource.get(s.id) ?? []).map((x) => `${x.id}@${x.updatedAt}`),
      ),
      loading,
      error,
    });
    // Only hand back a new identity on a real change — the
    // useSyncExternalStore contract.
    if (sig === signature) return;
    signature = sig;
    state = { sources, tasksBySource, loading, error };
    for (const l of listeners) l(state);
  }

  async function loadSource(source: TaskSource): Promise<void> {
    tasks.set(source.id, await provider().list(source));
  }

  async function resolveSources(): Promise<TaskSource[]> {
    if (!globalDir) globalDir = await ctx.storage.globalDir();
    const globalLocator = path.join(globalDir, TASKS_FILE);
    const out: TaskSource[] = [
      {
        id: hashLocator(SILO_PROVIDER_ID, globalLocator),
        providerId: SILO_PROVIDER_ID,
        locator: globalLocator,
        scope: "global",
        name: GLOBAL_SOURCE_NAME,
      },
    ];

    const ws = ctx.workspaces.getState();
    if (ws.activeId) {
      try {
        const dir = await ctx.storage.workspaceDir();
        const locator = path.join(dir, TASKS_FILE);
        const active = ws.all.find((w) => w.id === ws.activeId);
        out.push({
          id: hashLocator(SILO_PROVIDER_ID, locator),
          providerId: SILO_PROVIDER_ID,
          locator,
          scope: "workspace",
          workspaceId: ws.activeId,
          name: active?.name ?? "Workspace",
        });
      } catch (err) {
        if (!(err instanceof NoWorkspaceError)) throw err;
      }
    }

    const seen = new Set<string>();
    return out.filter((s) => {
      if (seen.has(s.locator)) return false;
      seen.add(s.locator);
      return true;
    });
  }

  function syncWatches(next: readonly TaskSource[]): void {
    const live = new Set(next.map((s) => s.id));
    for (const [id, w] of watches) {
      if (!live.has(id)) {
        w.dispose();
        watches.delete(id);
        tasks.delete(id);
      }
    }
    const p = provider();
    if (!p.watch) return;
    for (const source of next) {
      if (watches.has(source.id)) continue;
      watches.set(
        source.id,
        p.watch(source, () => {
          void loadSource(source)
            .then(() => commit(false, state.error))
            .catch((err) =>
              ctx.log.error(`reloading ${source.name} failed`, err),
            );
        }),
      );
    }
  }

  async function resolve(): Promise<void> {
    if (disposed) return;
    commit(true, null);
    let next: TaskSource[];
    try {
      next = await resolveSources();
    } catch (err) {
      ctx.log.error("resolving task storage failed", err);
      sources = [];
      commit(false, err instanceof Error ? err.message : "Task storage failed.");
      return;
    }
    sources = next;
    syncWatches(next);
    await Promise.all(
      next.map((s) =>
        loadSource(s).catch((err) => {
          ctx.log.error(`loading ${s.name} failed`, err);
          tasks.set(s.id, []);
        }),
      ),
    );
    ctx.log.info(
      `resolved ${next.length} source(s): ${next
        .map((s) => `${s.name} (${(tasks.get(s.id) ?? []).length})`)
        .join(", ")}`,
    );
    commit(false, null);
  }

  const wsSub = ctx.workspaces.subscribe(() => void resolve());

  async function mutateVia<T>(
    sourceId: string,
    run: (source: TaskSource, p: TaskProvider) => Promise<T>,
  ): Promise<T> {
    const source = sources.find((s) => s.id === sourceId);
    if (!source) throw new Error(`Unknown task source ${sourceId}`);
    const result = await run(source, provider());
    await loadSource(source);
    commit(false, state.error);
    return result;
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    start: resolve,
    refresh: async () => {
      await Promise.all(sources.map((s) => loadSource(s)));
      commit(false, state.error);
    },
    detail: (sourceId, taskId) => {
      const source = sources.find((s) => s.id === sourceId);
      if (!source) throw new Error(`Unknown task source ${sourceId}`);
      return provider().detail(source, taskId);
    },
    createTask: (sourceId, draft) =>
      mutateVia(sourceId, (source, p) => {
        if (!p.createTask) throw new Error("provider cannot create tasks");
        return p.createTask(source, draft);
      }),
    updateTask: (sourceId, taskId, patch) =>
      mutateVia(sourceId, (source, p) => {
        if (!p.updateTask) throw new Error("provider cannot update tasks");
        return p.updateTask(source, taskId, patch);
      }),
    setLane: (sourceId, taskId, lane) =>
      mutateVia(sourceId, (source, p) => {
        if (!p.setLane) throw new Error("provider cannot set lane");
        return p.setLane(source, taskId, lane);
      }),
    deleteTask: (sourceId, taskId) =>
      mutateVia(sourceId, (source, p) => {
        if (!p.deleteTask) throw new Error("provider cannot delete tasks");
        return p.deleteTask(source, taskId);
      }),
    resolveDestination: (pref) => {
      const workspace = sources.find((s) => s.scope === "workspace");
      const global = sources.find((s) => s.scope === "global");
      return pref === "workspace" && workspace ? workspace : global;
    },
    locate: (taskId) => {
      for (const source of sources) {
        const task = tasks.get(source.id)?.find((t) => t.id === taskId);
        if (task) return { source, task };
      }
      return undefined;
    },
    dispose: () => {
      disposed = true;
      wsSub.dispose();
      for (const w of watches.values()) w.dispose();
      watches.clear();
    },
  };
}
