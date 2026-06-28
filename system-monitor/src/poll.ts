import type { ExtensionContext, SystemInfo } from "@silo-code/sdk";
import { POLL_MS, pushCpuSample } from "./metrics";
import { selectCollector } from "./collectors";
import type { Collector } from "./collectors";
import { sysmonStore } from "./store";
import type { LiveData, PanelId, Settings } from "./store";

// Returns the set of metric ids that are currently visible (enabled in panel
// or status bar). The poll skips fetching a metric when it is not in this set.
export function neededMetrics(settings: Settings): Set<PanelId> {
  const needed = new Set<PanelId>();
  for (const item of [...settings.panels, ...settings.statusBar]) {
    if (item.enabled) needed.add(item.id);
  }
  return needed;
}

// A metric id maps to "cpu" or "memory" by prefix (e.g. "cpu-bar" → cpu), so
// any rendering variant of a metric triggers the underlying fetch.
export function wants(needed: Set<PanelId>, kind: "cpu" | "memory"): boolean {
  for (const id of needed) if (id.startsWith(kind)) return true;
  return false;
}

const OS_LABEL: Record<SystemInfo["os"], string> = {
  macos: "macOS",
  linux: "Linux",
  windows: "Windows",
};

/**
 * Start the metric poll loop. Resolves the host OS via `ctx.system`, selects the
 * matching collector once, then samples on an interval. Returns synchronously so
 * the caller keeps the simple dispose contract; the async setup runs in the
 * background and is a no-op if disposed before it finishes.
 */
export function startPolling(ctx: ExtensionContext): () => void {
  let cancelled = false;
  let collector: Collector | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function poll(): Promise<void> {
    if (!collector) return;
    const needed = neededMetrics(sysmonStore.settings);
    if (needed.size === 0) return;

    try {
      const [cpu, memory] = await Promise.all([
        wants(needed, "cpu") ? collector.cpu() : Promise.resolve(null),
        wants(needed, "memory") ? collector.memory() : Promise.resolve(null),
      ]);
      if (cancelled) return;

      const patch: Partial<LiveData> = { error: null };
      if (cpu) {
        patch.cpu = {
          userPct: cpu.user,
          sysPct: cpu.sys,
          history: pushCpuSample(
            sysmonStore.live.cpu?.history ?? [],
            cpu.user,
            cpu.sys,
          ),
        };
      }
      if (memory) patch.memory = memory;
      sysmonStore.updateLive(patch);
    } catch (e) {
      if (cancelled) return;
      const os = collector.os;
      sysmonStore.updateLive({
        error: `System Monitor couldn't read ${OS_LABEL[os]} metrics.\n${String(e)}`,
      });
    }
  }

  void (async () => {
    try {
      const { os } = await ctx.system.getInfo();
      if (cancelled) return;
      collector = selectCollector(os, ctx);
    } catch (e) {
      if (!cancelled) {
        sysmonStore.updateLive({
          error: `System Monitor couldn't detect the host platform.\n${String(e)}`,
        });
      }
      return;
    }
    void poll();
    timer = setInterval(() => void poll(), POLL_MS);
  })();

  return () => {
    cancelled = true;
    if (timer) clearInterval(timer);
  };
}
