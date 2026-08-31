/**
 * `providerId → TaskProvider`. Silo registers through the same path a future
 * provider (Beads, dex) would use — the registry has no notion of a "default"
 * or "built-in" provider.
 */

import type { TaskProvider } from "../model/source";

export interface ProviderRegistry {
  register(provider: TaskProvider): void;
  get(providerId: string): TaskProvider | undefined;
  all(): readonly TaskProvider[];
}

export function createProviderRegistry(): ProviderRegistry {
  const providers = new Map<string, TaskProvider>();
  return {
    register(provider) {
      providers.set(provider.id, provider);
    },
    get: (providerId) => providers.get(providerId),
    all: () => [...providers.values()],
  };
}
