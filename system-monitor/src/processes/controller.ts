// Lifecycle singleton for the Processes panel — thin glue over ctx.processes /
// ctx.process, patterned on `sysmonStore`. Owns the resources that differ from
// the CPU/memory poll (poll.ts): a push subscription, refcounted stats, and
// panel-active gating, so they only run while a user can actually see them.

import type { Disposable, ExtensionContext } from "@silo-code/sdk";
import { POLL_MS } from "../metrics";
import { sysmonStore } from "../store";
import { PS_ARGS, parsePsOutput } from "./ps";
import type { PsProcess } from "./ps";
import { buildAggregate, buildRows } from "./model";
import type { SessionRow } from "./model";

class ProcessesController {
  private ctx: ExtensionContext | null = null;
  private treesSupported = true;
  private panelActive = false;
  private running = false;

  private statsDisposable: Disposable | null = null;
  private subscribeDisposable: Disposable | null = null;
  private psTimer: ReturnType<typeof setInterval> | undefined;
  private psInFlight = false;
  private lastPs: PsProcess[] | null = null;
  private psError: string | null = null;
  private storeUnsubscribe: (() => void) | null = null;

  init(ctx: ExtensionContext): void {
    this.ctx = ctx;
    void ctx.system.getInfo().then(({ os }) => {
      this.treesSupported = os !== "windows";
      this.updateShouldRun();
    });
    this.storeUnsubscribe = sysmonStore.subscribe(() => this.updateShouldRun());
  }

  setPanelActive(active: boolean): void {
    this.panelActive = active;
    this.updateShouldRun();
  }

  private isEnabledInSettings(): boolean {
    return (
      sysmonStore.settings.panels.find((p) => p.id === "processes")
        ?.enabled ?? false
    );
  }

  private updateShouldRun(): void {
    const shouldRun = this.panelActive && this.isEnabledInSettings();
    if (shouldRun === this.running) return;
    this.running = shouldRun;
    if (shouldRun) this.acquire();
    else this.release();
  }

  private acquire(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.statsDisposable = ctx.processes.enableStats();
    this.subscribeDisposable = ctx.processes.subscribe(() => this.recompute());
    if (this.treesSupported) {
      void this.pollPs();
      this.psTimer = setInterval(() => void this.pollPs(), POLL_MS);
    }
    this.recompute();
  }

  // Releases the held resources but keeps the last computed live data in the
  // store, so switching side-panel tabs away and back doesn't flash empty.
  private release(): void {
    this.statsDisposable?.dispose();
    this.statsDisposable = null;
    this.subscribeDisposable?.dispose();
    this.subscribeDisposable = null;
    if (this.psTimer) clearInterval(this.psTimer);
    this.psTimer = undefined;
  }

  private async pollPs(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || this.psInFlight) return;
    this.psInFlight = true;
    try {
      const { stdout } = await ctx.process.exec("ps", PS_ARGS);
      this.lastPs = parsePsOutput(stdout);
      this.psError = null;
    } catch (e) {
      this.psError = `System Monitor couldn't read process details.\n${String(e)}`;
    } finally {
      this.psInFlight = false;
      this.recompute();
    }
  }

  private recompute(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const rows = buildRows(ctx.processes.getState(), this.lastPs);
    sysmonStore.updateLive({
      processes: {
        rows,
        agg: buildAggregate(rows),
        treesSupported: this.treesSupported,
        error: this.psError,
      },
    });
  }

  async killSession(row: SessionRow): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    const confirmed = await ctx.ui.confirm({
      title: `Kill ${row.leader}?`,
      body: `Terminates process group ${row.pgid} (${row.childCount + 1} processes) in "${row.title}". The shell stays open.`,
      confirmLabel: "Kill",
      danger: true,
    });
    if (!confirmed) return;
    try {
      await ctx.processes.kill(row.pgid);
    } catch (e) {
      ctx.ui.notify("error", String(e), {
        title: "Couldn't kill process group",
      });
    }
  }

  focusTerminal(terminalId: string): void {
    this.ctx?.terminals.focus(terminalId);
  }

  dispose(): void {
    this.release();
    this.storeUnsubscribe?.();
    this.storeUnsubscribe = null;
    this.ctx = null;
  }
}

export const processesController = new ProcessesController();
