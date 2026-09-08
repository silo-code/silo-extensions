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

/** One task, addressed by the source that holds it. */
export interface TaskTarget {
  sourceId: string;
  taskId: string;
}

/** Where the caret lands when the sheet opens (or re-reveals). */
export interface OpenAppOpts {
  /** Expand the composer and focus its title input. */
  focusComposer?: boolean;
  /** Focus the toolbar's search input. */
  focusSearch?: boolean;
}

export interface CommandDeps {
  sourceSet: SourceSet;
  bridge: PanelBridge;
  /** Reveal the Tasks side panel (`ctx.layout.revealSidePanel`). */
  revealPanel: () => void;
  notify: (level: "info" | "warn" | "error", message: string) => void;
  /**
   * Open the Tasks app sheet (`ctx.layout.openPanelSheet`), optionally landing
   * on one task's detail page and anchored to `anchorPanelId`. The returned
   * promise settles when the sheet closes — that is what the single-instance
   * guard below keys off.
   */
  openSheet: (
    target?: TaskTarget,
    anchorPanelId?: string,
    opts?: OpenAppOpts,
  ) => Promise<void>;
  /**
   * The mounted sheet's imperative handle, used to re-point an already open
   * sheet at another task rather than stacking a second one.
   */
  sheetBridge: PanelBridge;
  /** Report a failed sheet open. */
  logError: (message: string, err: unknown) => void;
}

export interface TaskCommands {
  /**
   * `title?` → created `Task` in the active workspace's list (the global
   * personal list when no workspace is open); no title → reveal panel + focus
   * quick-add → `undefined`. To create elsewhere, use `openApp` (its composer
   * has a list picker).
   */
  newInWorkspace(...args: unknown[]): Promise<Task | undefined>;
  /** Always reloads every resolved source. */
  refresh(): Promise<void>;
  /**
   * Open the Tasks app, optionally on one task. `openPanelSheet` has no
   * singleton option, so this tracks the one open sheet: a second call
   * re-reveals it (and re-points it at `target`, if given) instead of stacking
   * a second sheet. Works with no workspace open — the global list is always
   * there.
   *
   * `anchorPanelId` decides which dock column the sheet grows out of: the host
   * resolves the column from the panel it names. Pass the panel the click came
   * *from* — the Navigator's, for a row or the "Manage tasks" button in the
   * cross-workspace view — or omit it to anchor to the Tasks side panel (a
   * keybinding fired before that view has ever rendered).
   *
   * `opts.focusComposer` / `opts.focusSearch` open (or re-reveal) the sheet
   * with the caret in the composer's title input or the toolbar's search box —
   * the Navigator's "New task" / "Manage tasks" buttons.
   */
  openApp(
    target?: TaskTarget,
    anchorPanelId?: string,
    opts?: OpenAppOpts,
  ): void;
}

export function createCommands(deps: CommandDeps): TaskCommands {
  const { sourceSet, bridge, revealPanel, notify, logError, sheetBridge } = deps;

  async function newInWorkspace(
    ...args: unknown[]
  ): Promise<Task | undefined> {
    const title = typeof args[0] === "string" ? args[0].trim() : "";
    if (!title) {
      revealPanel();
      bridge.focusQuickAdd?.();
      return undefined;
    }
    const dest = sourceSet.resolveDestination("workspace");
    if (!dest) throw new Error("No task source is available.");
    return sourceSet.createTask(dest.id, { title });
  }

  let sheetOpen = false;

  return {
    newInWorkspace,
    refresh: () => sourceSet.refresh(),
    openApp: (target, anchorPanelId, opts) => {
      if (sheetOpen) {
        revealPanel();
        if (target) sheetBridge.drillTo?.(target.sourceId, target.taskId);
        if (opts?.focusComposer) sheetBridge.focusComposer?.();
        if (opts?.focusSearch) sheetBridge.focusSearch?.();
        return;
      }
      sheetOpen = true;
      void deps
        .openSheet(target, anchorPanelId, opts)
        .catch((err) => {
          logError("opening the Tasks app failed", err);
          notify("error", `Couldn't open the Tasks app: ${String(err)}`);
        })
        .finally(() => {
          sheetOpen = false;
        });
    },
  };
}
