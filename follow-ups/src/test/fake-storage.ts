/**
 * A fake `ExtensionStorage` for the store tests — an in-memory bag plus the
 * one behavior that matters: `subscribe` fires on every write, and can be
 * fired by hand to stand in for the async hydration notification.
 */

import type { Disposable, ExtensionStorage } from "@silo-code/sdk";

export interface FakeStorage extends ExtensionStorage {
  /** Write without notifying — stands in for "the bag hydrated behind us". */
  seed(key: string, value: unknown): void;
  /** Fire every subscriber, as hydration completing does. */
  fire(): void;
  /** How many `set` calls the code under test made. */
  writes: number;
}

export function fakeStorage(
  initial: Record<string, unknown> = {},
): FakeStorage {
  const bag = new Map<string, unknown>(Object.entries(initial));
  const listeners = new Set<() => void>();
  let writes = 0;

  const storage: FakeStorage = {
    get<T>(key: string, fallback?: T): T | undefined {
      return bag.has(key) ? (bag.get(key) as T) : fallback;
    },
    set(key, value) {
      writes++;
      storage.writes = writes;
      if (value === undefined) bag.delete(key);
      else bag.set(key, value);
      for (const l of [...listeners]) l();
    },
    keys: () => [...bag.keys()],
    subscribe(listener: () => void): Disposable {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    seed(key, value) {
      bag.set(key, value);
    },
    fire() {
      for (const l of [...listeners]) l();
    },
    writes: 0,
  };
  return storage;
}
