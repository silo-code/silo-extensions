/**
 * A tiny imperative bridge between the commands registered in `index.ts` and
 * the mounted panel. Commands can't reach React state directly; the panel
 * fills these in while mounted and clears them on unmount.
 */

export interface PanelBridge {
  /** Reveal the panel and focus the quick-add input. `null` while unmounted. */
  focusQuickAdd: (() => void) | null;
  /** The task currently drilled into, or `null`. */
  drilledTaskId: string | null;
  /** The source of the drilled-into task, or `null`. */
  drilledSourceId: string | null;
  /** Open the detail page for a task. `null` while unmounted. */
  drillTo: ((sourceId: string, taskId: string) => void) | null;
}

export function createPanelBridge(): PanelBridge {
  return {
    focusQuickAdd: null,
    drilledTaskId: null,
    drilledSourceId: null,
    drillTo: null,
  };
}
