/**
 * The one stateful object in the extension. Resolves the live sources — always
 * the global one, plus **one per open workspace** — owns a watch per source,
 * and exposes the {@link ReactiveService} shape so every surface reads it with
 * `useServiceState`.
 *
 * Because the source set is created once in `activate` and owned by the
 * extension (not a panel), lazily mounting or unmounting any one surface
 * neither reloads a source nor drops a watch — R2's "loaded once, not per
 * consumer". Phase 2 cashes that in: the side panel reads a two-source slice
 * (`selectScopedSources`), the Navigator view and the Tasks app sheet read the
 * whole set.
 *
 * `globalDir()` is resolved once and cached; the per-workspace directories come
 * from one `workspaceDirs({ create: false })` round-trip on every workspace
 * change — read-only resolution, so no directory is created for a workspace
 * that has no tasks yet.
 */

import type { ExtensionContext, ReactiveService } from "@silo-code/sdk";
import { path } from "@silo-code/sdk";
import type { Task, TaskDraft, TaskLane, TaskPatch } from "../model/task";
import type { DetailSection } from "../model/detail";
import { hashLocator, type TaskProvider, type TaskSource } from "../model/source";
import type { ProviderRegistry } from "../providers/registry";

const TASKS_FILE = "tasks.jsonl";
const SILO_PROVIDER_ID = "silo";
// Deliberately unnamed: the global list isn't tied to a workspace, so it gets
// no proper noun (tried "Personal", then "My Tasks" — both read oddly as one
// option in a dropdown of workspace names; see domain-language.md's Task
// Source entry). A group header for it renders with no label (TaskList /
// TaskRows already treat an empty `TaskGroup.title` as "the unnamed
// group"); TaskDetail's List field hides itself rather than show a blank
// value; the composer's list picker shows the placeholder word "No list"
// for it specifically (UI copy for an absent value, not this source's name).
const GLOBAL_SOURCE_NAME = "";

export interface SourceSetState {
  readonly sources: readonly TaskSource[];
  readonly tasksBySource: ReadonlyMap<string, readonly Task[]>;
  readonly loading: boolean;
  /**
   * A **wholesale** storage fault — `globalDir()` or `workspaceDirs()`
   * rejected, so nothing could be resolved. `null` when healthy. A single
   * workspace failing is not this; see
   * {@link SourceSetState.errorsBySource}.
   */
  readonly error: string | null;
  /**
   * Per-source load failures, keyed by source id. One unreadable workspace
   * lands here with an empty task list; every other source still loads.
   */
  readonly errorsBySource: ReadonlyMap<string, string>;
}

const EMPTY_STATE: SourceSetState = {
  sources: [],
  tasksBySource: new Map(),
  loading: true,
  error: null,
  errorsBySource: new Map(),
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

/**
 * The side panel's slice of the full set: the global source plus the **active**
 * workspace's, in that order. Pure — the panel's phase-1 behavior is unchanged
 * even though the set behind it now spans every open workspace.
 */
export function selectScopedSources(
  sources: readonly TaskSource[],
  activeWorkspaceId: string | null,
): readonly TaskSource[] {
  return sources.filter(
    (s) =>
      s.scope === "global" ||
      (activeWorkspaceId != null && s.workspaceId === activeWorkspaceId),
  );
}

export function createSourceSet(
  ctx: Ctx,
  providers: ProviderRegistry,
): SourceSet {
  let state: SourceSetState = EMPTY_STATE;
  let signature = "";
  let resolveSignature: string | null = null;
  let sources: readonly TaskSource[] = [];
  let globalDir: string | null = null;
  let disposed = false;

  const listeners = new Set<(s: SourceSetState) => void>();
  const watches = new Map<string, { dispose(): void }>();
  const tasks = new Map<string, readonly Task[]>();
  const sourceErrors = new Map<string, string>();

  function provider(): TaskProvider {
    const p = providers.get(SILO_PROVIDER_ID);
    if (!p) throw new Error("silo task provider not registered");
    return p;
  }

  function commit(loading: boolean, error: string | null): void {
    const tasksBySource = new Map(tasks);
    const errorsBySource = new Map(sourceErrors);
    const sig = JSON.stringify({
      s: sources.map((s) => `${s.id}:${s.name}`),
      t: sources.map((s) =>
        (tasksBySource.get(s.id) ?? []).map((x) => `${x.id}@${x.updatedAt}`),
      ),
      e: sources.map((s) => errorsBySource.get(s.id) ?? ""),
      loading,
      error,
    });
    // Only hand back a new identity on a real change — the
    // useSyncExternalStore contract.
    if (sig === signature) return;
    signature = sig;
    state = { sources, tasksBySource, loading, error, errorsBySource };
    for (const l of listeners) l(state);
  }

  async function loadSource(source: TaskSource): Promise<void> {
    tasks.set(source.id, await provider().list(source));
    sourceErrors.delete(source.id);
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

    // `create: false` — the aggregation only ever reads each workspace's file
    // (a missing one already reads as an empty list), so a workspace with no
    // tasks gets no directory written on its behalf. Writes still go through
    // `workspaceDir()` with its `create: true` default.
    const dirs = await ctx.storage.workspaceDirs({ create: false });
    const ws = ctx.workspaces.getState();
    const byId = new Map(ws.open.map((w) => [w.id, w]));
    for (const { workspaceId, dir } of dirs) {
      const workspace = byId.get(workspaceId);
      // `workspaceDirs()` is keyed off the same `open` list, but a workspace
      // closed between the two reads would have no record to name.
      if (!workspace) continue;
      const locator = path.join(dir, TASKS_FILE);
      out.push({
        id: hashLocator(SILO_PROVIDER_ID, locator),
        providerId: SILO_PROVIDER_ID,
        locator,
        scope: "workspace",
        workspaceId,
        name: workspace.name,
      });
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
        sourceErrors.delete(id);
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
          // One workspace's failure is isolated: it becomes an errored, empty
          // source and the rest of the set still loads (R1).
          ctx.log.error(`loading ${s.name} failed`, err);
          tasks.set(s.id, []);
          sourceErrors.set(s.id, err instanceof Error ? err.message : String(err));
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

  /**
   * The workspace facts resolution depends on: which workspaces are open and
   * what they're called. Any other workspace-state churn (a switch of the
   * active id, say) leaves the source set identical, so it must not re-resolve
   * and re-load N lists.
   */
  function workspaceSignature(): string {
    return ctx.workspaces
      .getState()
      .open.map((w) => `${w.id}:${w.name}`)
      .join("\n");
  }

  const wsSub = ctx.workspaces.subscribe(() => {
    const sig = workspaceSignature();
    if (sig === resolveSignature) return;
    resolveSignature = sig;
    void resolve();
  });

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
    start: async () => {
      resolveSignature = workspaceSignature();
      await resolve();
    },
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
      // With N workspace sources resolved, "the workspace list" can only mean
      // the *active* workspace's — never whichever one happens to sort first.
      const activeId = ctx.workspaces.getState().activeId;
      const workspace = sources.find(
        (s) => s.scope === "workspace" && s.workspaceId === activeId,
      );
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
