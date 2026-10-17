/**
 * A `ReactiveService` wrapper around the marks {@link MarksState}, so the
 * Navigator view can read it through `useServiceState`.
 *
 * `MarksState` is a `Map` mutated **in place** by `store.ts` — which is what
 * the chrome binders want (no allocation per paint) but exactly what
 * `useSyncExternalStore` can't see. So the published state is a snapshot
 * wrapper whose *identity* changes on every notify, with the live map hanging
 * off it. React re-renders; the binders keep their cheap map.
 *
 * Pure — `import type` only.
 */

import type { ReactiveService } from "@silo-code/sdk";
import type { MarksState } from "./store";

export interface MarksSnapshot {
  state: MarksState;
  /** Bumped on every notify — the identity React compares. */
  version: number;
}

export interface MarksStore extends ReactiveService<MarksSnapshot> {
  /** The live map, for the synchronous chrome binders. */
  marks(): MarksState;
  /** Publish an in-place mutation. */
  notify(): void;
  /** Swap the whole map (a re-parse after an external storage change). */
  replace(next: MarksState): void;
}

export function createMarksStore(initial: MarksState): MarksStore {
  let snapshot: MarksSnapshot = { state: initial, version: 0 };
  const listeners = new Set<(s: MarksSnapshot) => void>();

  function publish() {
    snapshot = { state: snapshot.state, version: snapshot.version + 1 };
    for (const l of listeners) l(snapshot);
  }

  return {
    getState: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    marks: () => snapshot.state,
    notify: publish,
    replace(next) {
      snapshot = { state: next, version: snapshot.version };
      publish();
    },
  };
}
