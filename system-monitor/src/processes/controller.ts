// Lifecycle singleton for the Processes panel — thin glue over ctx.processes /
// ctx.workspaces, patterned on `sysmonStore`. Owns the resources that differ
// from the CPU/memory poll (poll.ts): refcounted stats+trees and panel-active
// gating, so they only run while a user can actually see them. Stats, trees,
// and foreground changes all arrive on the one subscribe channel.

import type { Disposable, ExtensionContext, WorkspaceBadge, WorkspaceStatusRow } from "@silo-code/sdk";
import { sysmonStore } from "../store";
import {
  buildAggregate,
  buildRows,
  computeBadges,
  computeStatusRows,
  groupInfosByWorkspace,
} from "./model";
import type { ProcessesData, SessionRow } from "./model";

class ProcessesController {
  private ctx: ExtensionContext | null = null;
  private panelActive = false;
  private running = false;

  private statsDisposable: Disposable | null = null;
  private subscribeDisposable: Disposable | null = null;
  private statusDisposable: Disposable | null = null;
  private badgeDisposable: Disposable | null = null;
  private storeUnsubscribe: (() => void) | null = null;

  // Keyed by workspaceId — `provide(workspaceId)` is called once per row the
  // Workspaces panel renders, for every loaded workspace, not just the active
  // one.
  private statusByWorkspace = new Map<string, WorkspaceStatusRow[]>();
  private badgesByWorkspace = new Map<string, WorkspaceBadge[]>();
  private lastStatusJson = "[]";
  private lastBadgeJson = "[]";

  init(ctx: ExtensionContext): void {
    this.ctx = ctx;
    this.storeUnsubscribe = sysmonStore.subscribe(() => this.updateShouldRun());

    this.statusDisposable = ctx.workspaces.registerStatus({
      id: "silo.system-monitor.status",
      provide: (workspaceId) => this.statusByWorkspace.get(workspaceId) ?? [],
    });

    this.badgeDisposable = ctx.workspaces.registerBadge({
      id: "silo.system-monitor.badges",
      provide: (workspaceId) => this.badgesByWorkspace.get(workspaceId) ?? [],
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
    this.statsDisposable = ctx.processes.enableStats({ trees: true });
    this.subscribeDisposable = ctx.processes.subscribe(() => this.recompute(), {
      allWorkspaces: true,
    });
    this.recompute();
  }

  // Releases the held resources but keeps the last computed live data in the
  // store, so switching side-panel tabs away and back doesn't flash empty.
  private release(): void {
    this.statsDisposable?.dispose();
    this.statsDisposable = null;
    this.subscribeDisposable?.dispose();
    this.subscribeDisposable = null;
  }

  private recompute(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const wsState = ctx.workspaces.getState();

    // Use TerminalRecord.title (the live PTY-derived title) so each workspace's
    // rows match what its tabs show, rather than ProcessInfo.terminalTitle
    // which prefers customName over the current process title.
    const terminalTitlesByWorkspace = new Map(
      wsState.all.map((ws) => [
        ws.id,
        new Map(ws.terminals.map((t) => [t.id, t.title])),
      ]),
    );

    const infosByWorkspace = groupInfosByWorkspace(
      ctx.processes.getState({ allWorkspaces: true }),
    );

    const dataByWorkspace = new Map<string, ProcessesData>();
    for (const ws of wsState.all) {
      const rows = buildRows(
        infosByWorkspace.get(ws.id) ?? [],
        terminalTitlesByWorkspace.get(ws.id),
      );
      dataByWorkspace.set(ws.id, { rows, agg: buildAggregate(rows) });
    }

    const activeData = (wsState.activeId ? dataByWorkspace.get(wsState.activeId) : undefined) ?? {
      rows: [],
      agg: buildAggregate([]),
    };
    sysmonStore.updateLive({ processes: activeData });

    this.updateWorkspaceProviders(ctx, dataByWorkspace);
  }

  private updateWorkspaceProviders(
    ctx: ExtensionContext,
    dataByWorkspace: Map<string, ProcessesData>,
  ): void {
    const enabled = sysmonStore.settings.workspaceStatus;

    const nextStatusByWorkspace = new Map<string, WorkspaceStatusRow[]>();
    const nextBadgesByWorkspace = new Map<string, WorkspaceBadge[]>();
    if (enabled) {
      for (const [workspaceId, data] of dataByWorkspace) {
        nextStatusByWorkspace.set(workspaceId, computeStatusRows(data.rows));
        nextBadgesByWorkspace.set(workspaceId, computeBadges(data.agg));
      }
    }

    const nextStatusJson = JSON.stringify([...nextStatusByWorkspace]);
    if (nextStatusJson !== this.lastStatusJson) {
      this.lastStatusJson = nextStatusJson;
      this.statusByWorkspace = nextStatusByWorkspace;
      ctx.workspaces.invalidateStatus();
    }

    const nextBadgeJson = JSON.stringify([...nextBadgesByWorkspace]);
    if (nextBadgeJson !== this.lastBadgeJson) {
      this.lastBadgeJson = nextBadgeJson;
      this.badgesByWorkspace = nextBadgesByWorkspace;
      ctx.workspaces.invalidateBadges();
    }
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
