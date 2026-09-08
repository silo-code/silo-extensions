/**
 * A tiny imperative bridge between the commands registered in `index.ts` and
 * the mounted panel. Commands can't reach React state directly; the panel
 * fills these in while mounted and clears them on unmount.
 */

export interface PanelBridge {
  /** Reveal the panel and focus the quick-add input. `null` while unmounted. */
  focusQuickAdd: (() => void) | null;
  /**
   * Expand the sheet's composer and focus its title input. Set only by the
   * surface that renders the composer (the sheet); `null` otherwise.
   */
  focusComposer: (() => void) | null;
  /**
   * Focus the toolbar's search input. Set only by a surface that renders it
   * (the sheet); `null` otherwise.
   */
  focusSearch: (() => void) | null;
  /** Open the detail page for a task. `null` while unmounted. */
  drillTo: ((sourceId: string, taskId: string) => void) | null;
}

export function createPanelBridge(): PanelBridge {
  return {
    focusQuickAdd: null,
    focusComposer: null,
    focusSearch: null,
    drillTo: null,
  };
}
