// Lifecycle singleton for the Processes panel — thin glue over ctx.processes /
// ctx.workspaces, patterned on `sysmonStore`. Owns the resources that differ
// from the CPU/memory poll (poll.ts): refcounted stats+trees and the run
// condition below, so they only run while there's a consumer. Stats, trees,
// and foreground changes all arrive on the one subscribe channel.

import type { Disposable, ExtensionContext, WorkspaceBadge, WorkspaceStatusRow } from "@silo-code/sdk";
import { sysmonStore } from "../store";
import type { Settings } from "../store";
import {
  buildAggregate,
  buildAllProcessesEntries,
  buildRows,
  computeBadges,
  computeStatusRows,
  groupInfosByWorkspace,
} from "./model";
import type { ProcessesData, ProcessThresholds, SessionRow } from "./model";

/**
 * Whether the stats+subscribe resources should be held. "Workspace status"
 * (badges/status rows across every loaded workspace) is an ambient monitor —
 * it must run whenever the setting is on, independent of `panelActive`, or a
 * background workspace's badge would flicker on and off as the user opens
 * and closes the System Monitor side panel elsewhere. The Processes *panel*
 * view is the only part actually gated by panel visibility, since nobody can
 * see it otherwise — and the all-workspaces modal holds the resources for as
 * long as it's open, so it gets live data even with both of those off.
 */
export function shouldRunProcesses(
  settings: Settings,
  panelActive: boolean,
  modalActive = false,
): boolean {
  const processesPanelEnabled = settings.panels.some(
    (p) => p.id === "processes" && p.enabled,
  );
  return (
    (panelActive && processesPanelEnabled) ||
    settings.workspaceStatus ||
    modalActive
  );
}

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

    // "Workspace status" is an ambient, always-on monitor across every loaded
    // workspace (see SystemMonitorSettings' "Show CPU and memory warnings in
    // the workspace status row and badge") — it must not depend on whether the
    // side panel (this workspace's, specifically) happens to be open, or a
    // badge would flicker on and off as the user switches workspaces. So run
    // it as soon as the setting is on, independent of `panelActive` below.
    this.updateShouldRun();
  }

  /** The context, for collaborators that drive host UI (the processes modal). */
  get context(): ExtensionContext | null {
    return this.ctx;
  }

  setPanelActive(active: boolean): void {
    this.panelActive = active;
    this.updateShouldRun();
  }

  private updateShouldRun(): void {
    // modalActive lives on the store (the metric poll reads it too); the store
    // subscription from init() re-runs this whenever it flips.
    const shouldRun = shouldRunProcesses(
      sysmonStore.settings,
      this.panelActive,
      sysmonStore.modalActive,
    );
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

    // Include soft-closed workspaces — close keeps PTYs alive (hard-delete
    // is what reaps them), so a closed group with running agents must still
    // show in the all-workspaces modal. Empty groups are filtered in the UI.
    const allProcesses = buildAllProcessesEntries(
      wsState.all,
      wsState.activeId,
      dataByWorkspace,
    );

    sysmonStore.updateLive({ processes: activeData, allProcesses });

    this.updateWorkspaceProviders(ctx, dataByWorkspace);
  }

  private updateWorkspaceProviders(
    ctx: ExtensionContext,
    dataByWorkspace: Map<string, ProcessesData>,
  ): void {
    const settings = sysmonStore.settings;

    const nextStatusByWorkspace = new Map<string, WorkspaceStatusRow[]>();
    const nextBadgesByWorkspace = new Map<string, WorkspaceBadge[]>();
    if (settings.workspaceStatus) {
      const thresholds: ProcessThresholds = {
        cpuWarnPercent: settings.cpuWarnPercent,
        cpuDangerPercent: settings.cpuDangerPercent,
        memWarnMb: settings.memWarnMb,
        memDangerMb: settings.memDangerMb,
      };
      for (const [workspaceId, data] of dataByWorkspace) {
        nextStatusByWorkspace.set(
          workspaceId,
          computeStatusRows(data.rows, thresholds),
        );
        nextBadgesByWorkspace.set(
          workspaceId,
          computeBadges(data.agg, thresholds),
        );
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

  /** Jump to a session that may live in another workspace: activate that
   * workspace first, then focus the terminal. */
  focusSession(workspaceId: string, terminalId: string): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.workspaces.getState().activeId !== workspaceId) {
      ctx.workspaces.activate(workspaceId);
    }
    ctx.terminals.focus(terminalId);
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
