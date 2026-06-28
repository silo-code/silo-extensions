import type { ExtensionContext, SystemInfo } from "@silo-code/sdk";
import type { Collector } from "./types";
import { createMacosCollector } from "./macos";
import { createLinuxCollector } from "./linux";
import { createWindowsCollector } from "./windows";

export type { Collector, CpuReading, MemReading } from "./types";

/**
 * Pick the metric collector for the host OS reported by `ctx.system`. The `os`
 * field is an exhaustive union, so every case is handled — adding a platform to
 * the SDK surfaces here as a compile error until a collector exists for it.
 */
export function selectCollector(
  os: SystemInfo["os"],
  ctx: ExtensionContext,
): Collector {
  switch (os) {
    case "macos":
      return createMacosCollector(ctx);
    case "linux":
      return createLinuxCollector(ctx);
    case "windows":
      return createWindowsCollector(ctx);
  }
}
