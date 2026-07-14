// Lifecycle singleton for the Processes panel — thin glue over ctx.processes /
// ctx.process, patterned on `sysmonStore`. Owns the resources that differ from
// the CPU/memory poll (poll.ts): a push subscription, refcounted stats, and
// panel-active gating, so they only run while a user can actually see them.

import type { Disposable, ExtensionContext, WorkspaceBadge, WorkspaceStatusRow } from "@silo-code/sdk";
import { POLL_MS } from "../metrics";
import { sysmonStore } from "../store";
import { PS_ARGS, parsePsOutput } from "./ps";
import type { PsProcess } from "./ps";
import { buildAggregate, buildRows, formatCpu, formatMem, displayName } from "./model";
import type { ProcessesAggregate, SessionRow } from "./model";

const WARN_COLOR = "#e3b341";
const DANGER_COLOR = "#f47067";

class ProcessesController {
  private ctx: ExtensionContext | null = null;
  private treesSupported = true;
  private panelActive = false;
  private running = false;

  private statsDisposable: Disposable | null = null;
  private subscribeDisposable: Disposable | null = null;
  private statusDisposable: Disposable | null = null;
  private badgeDisposable: Disposable | null = null;
  private psTimer: ReturnType<typeof setInterval> | undefined;
  private psInFlight = false;
  private lastPs: PsProcess[] | null = null;
  private psError: string | null = null;
  private storeUnsubscribe: (() => void) | null = null;

  private activeWorkspaceId: string | null = null;
  private statusRows: WorkspaceStatusRow[] = [];
  private badges: WorkspaceBadge[] = [];
  private lastStatusJson = "[]";
  private lastBadgeJson = "[]";

  init(ctx: ExtensionContext): void {
    this.ctx = ctx;
    void ctx.system.getInfo().then(({ os }) => {
      this.treesSupported = os !== "windows";
      this.updateShouldRun();
    });
    this.storeUnsubscribe = sysmonStore.subscribe(() => this.updateShouldRun());

    this.statusDisposable = ctx.workspaces.registerStatus({
      id: "silo.system-monitor.status",
      provide: (workspaceId) => {
        if (workspaceId !== this.activeWorkspaceId) return [];
        return this.statusRows;
      },
    });

    this.badgeDisposable = ctx.workspaces.registerBadge({
      id: "silo.system-monitor.badges",
      provide: (workspaceId) => {
        if (workspaceId !== this.activeWorkspaceId) return [];
        return this.badges;
      },
    });
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
    // Use TerminalRecord.title (the live PTY-derived title) so the panel matches
    // what the tab shows, rather than ProcessInfo.terminalTitle which prefers
    // customName over the current process title.
    const wsState = ctx.workspaces.getState();
    this.activeWorkspaceId = wsState.activeId;
    const activeWs = wsState.all.find((ws) => ws.id === wsState.activeId);
    const terminalTitles = new Map(
      (activeWs?.terminals ?? []).map((t) => [t.id, t.title]),
    );
    const rows = buildRows(ctx.processes.getState(), this.lastPs, terminalTitles);
    const agg = buildAggregate(rows);
    sysmonStore.updateLive({
      processes: {
        rows,
        agg,
        treesSupported: this.treesSupported,
        error: this.psError,
      },
    });
    this.updateWorkspaceProviders(ctx, rows, agg);
  }

  private updateWorkspaceProviders(
    ctx: ExtensionContext,
    rows: SessionRow[],
    agg: ProcessesAggregate,
  ): void {
    const enabled = sysmonStore.settings.workspaceStatus;

    const nextStatus = enabled ? this.computeStatusRows(rows) : [];
    const nextStatusJson = JSON.stringify(nextStatus);
    if (nextStatusJson !== this.lastStatusJson) {
      this.lastStatusJson = nextStatusJson;
      this.statusRows = nextStatus;
      ctx.workspaces.invalidateStatus();
    }

    const nextBadges = enabled ? this.computeBadges(agg) : [];
    const nextBadgeJson = JSON.stringify(nextBadges);
    if (nextBadgeJson !== this.lastBadgeJson) {
      this.lastBadgeJson = nextBadgeJson;
      this.badges = nextBadges;
      ctx.workspaces.invalidateBadges();
    }
  }

  private computeStatusRows(rows: SessionRow[]): WorkspaceStatusRow[] {
    const result: WorkspaceStatusRow[] = [];
    for (const row of rows) {
      const cpu = row.totalCpuPercent ?? 0;
      const mem = row.totalMemoryMb ?? 0;
      const cpuWarn = cpu >= 25;
      const memWarn = mem >= 500;
      if (!cpuWarn && !memWarn) continue;

      const status = cpu >= 75 || mem >= 2000 ? "error" : "warn";
      const parts: string[] = [];
      if (cpuWarn) parts.push(`${formatCpu(row.totalCpuPercent)} CPU`);
      if (memWarn) parts.push(formatMem(row.totalMemoryMb));
      result.push({
        id: row.sessionId,
        status,
        label: `${displayName(row.leader)}: ${parts.join(" · ")}`,
      });
    }
    return result;
  }

  private computeBadges(agg: ProcessesAggregate): WorkspaceBadge[] {
    const result: WorkspaceBadge[] = [];
    const cpu = agg.cpuPercent;
    const mem = agg.memoryMb;
    if (cpu >= 25) {
      result.push({
        id: "cpu",
        text: "CPU",
        color: cpu >= 75 ? DANGER_COLOR : WARN_COLOR,
      });
    }
    if (mem >= 500) {
      result.push({
        id: "mem",
        text: "MEM",
        color: mem >= 2000 ? DANGER_COLOR : WARN_COLOR,
      });
    }
    return result;
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
    this.statusDisposable?.dispose();
    this.statusDisposable = null;
    this.badgeDisposable?.dispose();
    this.badgeDisposable = null;
    this.storeUnsubscribe?.();
    this.storeUnsubscribe = null;
    this.ctx = null;
  }
}

export const processesController = new ProcessesController();
