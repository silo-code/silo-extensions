/**
 * The extension's own settings — the five labels: their names, their order,
 * and which one is the default. A small reactive store implementing the SDK's
 * `ReactiveService`, so the settings page reads it through `useServiceState`.
 *
 * Persisted via `ctx.storage.global` (shared across workspaces — labels are a
 * general preference, not per-project).
 *
 * Kept free of any *runtime* `@silo-code/sdk` import (types only) so this
 * module — and its unit test — never loads the SDK package at all. `ui/` is
 * the thin layer that adds the runtime imports.
 */

import type { Disposable, ExtensionStorage, ReactiveService } from "@silo-code/sdk";
import {
  coerceLabels,
  defaultLabel,
  type FollowUpLabel,
  type StoredLabel,
} from "./labels";

export const STORAGE_KEY_LABELS = "labels";

export interface FollowUpsSettings {
  /**
   * The five labels, in the user's order. Always exactly five, always exactly
   * one default, every name non-empty — see `coerceLabels`.
   */
  labels: FollowUpLabel[];
}

export interface SettingsStore extends ReactiveService<FollowUpsSettings> {
  setLabels(labels: readonly FollowUpLabel[]): void;
  /** Detach the `storage.subscribe`. Push onto `ctx.subscriptions`. */
  dispose(): void;
}

function toStored(labels: readonly FollowUpLabel[]): StoredLabel[] {
  return labels.map((l) => ({
    id: l.id,
    name: l.name,
    isDefault: l.isDefault,
  }));
}

function sameLabels(
  a: readonly FollowUpLabel[],
  b: readonly FollowUpLabel[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (l, i) =>
        l.id === b[i].id &&
        l.name === b[i].name &&
        l.isDefault === b[i].isDefault,
    )
  );
}

/**
 * Bind persisted storage to a settings store — call once from `activate()`.
 *
 * Reads immediately **and** re-reads on every storage change, because
 * `ctx.storage` hydrates asynchronously: a value saved last session may not be
 * present at the instant `activate` runs, so the first read can legitimately
 * return the shipped defaults and the `subscribe` fire is what corrects it.
 */
export function initSettings(storage: ExtensionStorage): SettingsStore {
  let state: FollowUpsSettings = read();
  const listeners = new Set<(s: FollowUpsSettings) => void>();

  function read(): FollowUpsSettings {
    return { labels: coerceLabels(storage.get(STORAGE_KEY_LABELS)) };
  }

  function emit() {
    for (const l of listeners) l(state);
  }

  function refresh() {
    const next = read();
    if (sameLabels(next.labels, state.labels)) return;
    state = next;
    emit();
  }

  const sub: Disposable = storage.subscribe(refresh);

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    dispose: () => sub.dispose(),
    setLabels(labels) {
      // Round-trip through `coerceLabels` so a caller can't install a list
      // that breaks the five/one-default invariants the rest of the extension
      // relies on.
      const next = coerceLabels(toStored(labels));
      if (sameLabels(next, state.labels)) return;
      // Update in-memory state *before* persisting, so the `storage.subscribe`
      // refresh above sees no diff and doesn't emit a second time.
      state = { ...state, labels: next };
      emit();
      storage.set(STORAGE_KEY_LABELS, toStored(next));
    },
  };
}

/** The default label id of a settings snapshot — what an unqualified mark uses. */
export function defaultLabelId(settings: FollowUpsSettings) {
  return defaultLabel(settings.labels).id;
}
