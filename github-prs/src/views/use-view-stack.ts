import { useCallback, useEffect, useState } from "react";
import type { ExtensionStorage } from "@silo-code/sdk";
import {
  ROOT_STACK,
  currentView,
  popView,
  pushView,
  restoreStack,
  serializeStack,
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
// persists every push/pop. Panel storage is already workspace-scoped.
export function useViewStack(storage: ExtensionStorage, hydrated: boolean): UseViewStackResult {
  const [stack, setStack] = useState<ViewStack>(ROOT_STACK);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    if (!hydrated || restored) return;
    setStack(restoreStack(storage.get(STORAGE_KEY)));
    setRestored(true);
  }, [hydrated, restored, storage]);

  useEffect(() => {
    if (!restored) return;
    storage.set(STORAGE_KEY, serializeStack(stack));
  }, [stack, restored, storage]);

  const push = useCallback((view: PanelView) => {
    setStack((s) => pushView(s, view));
  }, []);

  const pop = useCallback(() => {
    setStack((s) => popView(s));
  }, []);

  return { view: currentView(stack), push, pop };
}
