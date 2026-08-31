/**
 * The command runners, extracted from `index.ts` so they are unit-testable
 * without a DOM. No public `TasksApi` — commands are the driving surface for
 * other extensions and agents (R12). No command silently does nothing from a
 * keybinding with no args: the ones that need a target fall back to a visible
 * affordance.
 */

import type { Task } from "./model/task";
import type { SourceSet } from "./sources/source-set";
import type { PanelBridge } from "./ui/panel-bridge";

export interface CommandDeps {
  sourceSet: SourceSet;
  bridge: PanelBridge;
  /** Reveal the Tasks side panel (`ctx.layout.revealSidePanel`). */
  revealPanel: () => void;
  notify: (level: "info" | "warn" | "error", message: string) => void;
}

export interface TaskCommands {
  /**
   * `title?` → created `Task` in the active workspace's list (the global list
   * when no workspace is open); no title → reveal panel + focus quick-add →
   * `undefined`.
   */
  newTask(...args: unknown[]): Promise<Task | undefined>;
  /** As `newTask`, but always the global (personal) list. */
  newInGlobal(...args: unknown[]): Promise<Task | undefined>;
  /** Always reloads every resolved source. */
  refresh(): Promise<void>;
  /**
   * `taskId?` → completed `Task`. No arg → completes the drilled-into task;
   * no arg and no drill-in → reveal panel + notify. Unknown id → rejects
   * naming the id, mutates nothing.
   */
  complete(...args: unknown[]): Promise<Task | undefined>;
}

export function createCommands(deps: CommandDeps): TaskCommands {
  const { sourceSet, bridge, revealPanel, notify } = deps;

  async function create(
    args: unknown[],
    scope: "workspace" | "global",
  ): Promise<Task | undefined> {
    const title = typeof args[0] === "string" ? args[0].trim() : "";
    if (!title) {
      revealPanel();
      bridge.focusQuickAdd?.();
      return undefined;
    }
    const dest = sourceSet.resolveDestination(scope);
    if (!dest) throw new Error("No task source is available.");
    return sourceSet.createTask(dest.id, { title });
  }

  return {
    newTask: (...args) => create(args, "workspace"),
    newInGlobal: (...args) => create(args, "global"),
    refresh: () => sourceSet.refresh(),
    complete: async (...args) => {
      const taskId =
        typeof args[0] === "string" ? args[0] : bridge.drilledTaskId;
      if (!taskId) {
        revealPanel();
        notify("info", "Select a task to complete.");
        return undefined;
      }
      const located = sourceSet.locate(taskId);
      if (!located) throw new Error(`No task with id ${taskId}.`);
      return sourceSet.setLane(located.source.id, taskId, "done");
    },
  };
}
