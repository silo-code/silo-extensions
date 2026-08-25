/**
 * Tiny pub/sub so commands (palette / keybinding) can open the browse sheet
 * even when the panel was lazy-mounted or the command carried no args.
 */

type Listener = () => void;

const listeners = new Set<Listener>();
let pending = false;

/** Ask the Skills panel to open its skills.sh browse sheet. */
export function requestBrowseSheet(): void {
  pending = true;
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // Panel listeners must not break each other.
    }
  }
}

/**
 * Subscribe to browse-sheet open requests. If a request arrived before the
 * panel mounted, the listener is invoked once immediately.
 */
export function onBrowseSheetRequest(listener: Listener): () => void {
  listeners.add(listener);
  if (pending) {
    pending = false;
    queueMicrotask(() => {
      try {
        listener();
      } catch {
        /* ignore */
      }
    });
  }
  return () => {
    listeners.delete(listener);
  };
}

/** Test helper — clear listeners and the pending flag. */
export function resetBrowseSheetBus(): void {
  listeners.clear();
  pending = false;
}
