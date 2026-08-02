import { useCallback, useEffect, useState } from "react";
import type { ExtensionStorage } from "@silo-code/sdk";
import {
  ROOT_STACK,
  currentView,
  popView,
  pushView,
  restoreStack,
  serializeStack,
  shouldRestoreStack,
  type PanelView,
  type ViewStack,
} from "../view-stack";

const STORAGE_KEY = "viewStack";

export interface UseViewStackResult {
  view: PanelView;
  push: (view: PanelView) => void;
  pop: () => void;
}

// Restores the per-workspace panel stack once storage is hydrated, then
// persists every push/pop. `storage` itself is a stable object reused across
// workspace switches (only the bag it reads from is swapped underneath it),
// so re-restoring is keyed off `workspaceId` changing, not just `hydrated`
// flipping true once — otherwise switching workspaces leaves the previous
// workspace's view (e.g. a PR detail page) stuck on screen instead of
// reflecting the newly-active workspace's own persisted stack.
export function useViewStack(
  storage: ExtensionStorage,
  hydrated: boolean,
  workspaceId: string,
): UseViewStackResult {
  const [stack, setStack] = useState<ViewStack>(ROOT_STACK);
  const [restoredFor, setRestoredFor] = useState<string | null>(null);

  useEffect(() => {
    if (!shouldRestoreStack(hydrated, restoredFor, workspaceId)) return;
    setStack(restoreStack(storage.get(STORAGE_KEY)));
    setRestoredFor(workspaceId);
  }, [hydrated, restoredFor, storage, workspaceId]);

  useEffect(() => {
    if (restoredFor !== workspaceId) return;
    storage.set(STORAGE_KEY, serializeStack(stack));
  }, [stack, restoredFor, workspaceId, storage]);

  const push = useCallback((view: PanelView) => {
    setStack((s) => pushView(s, view));
  }, []);

  const pop = useCallback(() => {
    setStack((s) => popView(s));
  }, []);

  return { view: currentView(stack), push, pop };
}
