// Cross-workspace process inspector, styled after the Windows 11 Task Manager:
// mini CPU/memory history graphs up top, a filter box, a column-header row
// with grand totals, collapsible per-workspace groups (hottest first), and a
// selection + End Task footer. Opened from the side panel's footer link and
// the status bar chips — the entry point when system CPU is climbing and you
// don't know which workspace (if any) is the cause.

import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useSize, useStore } from "../hooks";
import { formatCpu, formatMem, displayName } from "../processes/model";
import type { SessionRow } from "../processes/model";
import type { Settings, WorkspaceProcessesData } from "../store";
import { sysmonStore } from "../store";
import { processesController } from "../processes/controller";
import { flattenTree } from "../processes/tree";
import { ChevronIcon } from "../icons";
import { CpuBarChart } from "../metrics/cpu/Panel";
import { MEM_COLORS } from "../collectors/palette";

let modalOpen = false;

/** Opens the modal (no-op if it's already open or the extension isn't active).
 * Marks the modal active on the store for its lifetime, which holds both the
 * processes stats subscription and CPU/memory polling for the mini graphs. */
export async function openAllProcessesModal(): Promise<void> {
  const ctx = processesController.context;
  if (!ctx || modalOpen) return;
  modalOpen = true;
  sysmonStore.setModalActive(true);
  try {
    await ctx.ui.showModal(
      (close) => <AllProcessesModal onClose={() => close()} />,
      { title: "Processes — All Workspaces", size: "lg", dismissible: true },
    );
  } finally {
    modalOpen = false;
    sysmonStore.setModalActive(false);
  }
}

// ─── Sorting ───────────────────────────────────────────────────────────────────

type SortKey = "name" | "cpu" | "mem";
interface Sort {
  key: SortKey;
  dir: 1 | -1; // 1 = ascending
}

const DEFAULT_DIR: Record<SortKey, 1 | -1> = { name: 1, cpu: -1, mem: -1 };

function compareRows(a: SessionRow, b: SessionRow, sort: Sort): number {
  if (sort.key === "name") return a.title.localeCompare(b.title) * sort.dir;
  const av = sort.key === "cpu" ? (a.totalCpuPercent ?? 0) : (a.totalMemoryMb ?? 0);
  const bv = sort.key === "cpu" ? (b.totalCpuPercent ?? 0) : (b.totalMemoryMb ?? 0);
  return (av - bv) * sort.dir;
}

function compareGroups(
  a: WorkspaceProcessesData,
  b: WorkspaceProcessesData,
  sort: Sort,
): number {
  if (sort.key === "name") return a.name.localeCompare(b.name) * sort.dir;
  const av = sort.key === "cpu" ? a.data.agg.cpuPercent : a.data.agg.memoryMb;
  const bv = sort.key === "cpu" ? b.data.agg.cpuPercent : b.data.agg.memoryMb;
  return (av - bv) * sort.dir;
}

// ─── Heat tint ─────────────────────────────────────────────────────────────────

/** Windows-style heat cell: background tint that deepens with load, hitting
 * full intensity at the user's configured danger threshold. */
function heatStyle(value: number | null, dangerAt: number): CSSProperties | undefined {
  if (value == null || value <= 0) return undefined;
  const frac = Math.min(value / dangerAt, 1);
  const pct = Math.round(frac * 34);
  if (pct < 2) return undefined;
  return {
    background: `color-mix(in srgb, var(--silo-color-warn, #e3b341) ${pct}%, transparent)`,
  };
}

// ─── Mini history graphs ───────────────────────────────────────────────────────

/** A shrunken version of the side panel's CPU card: title/value header over a
 * right-aligned bar chart in the same chart-wrap surface. */
function MiniGraph({
  title,
  value,
  data,
  userColor,
  sysColor,
}: {
  title: string;
  value: string;
  data: { user: number; sys: number }[];
  userColor?: string;
  sysColor?: string;
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  const { w, h } = useSize(chartRef);
  return (
    <div className="sm-pm-graph">
      <div className="sm-pm-graph-head">
        <span className="sm-title">{title}</span>
        <span className="sm-headline">{value}</span>
      </div>
      <div className="sm-chart-wrap sm-pm-graph-chart" ref={chartRef}>
        {data.length === 0 ? (
          <div className="sm-waiting">waiting…</div>
        ) : (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "flex-end",
            }}
          >
            <CpuBarChart
              data={data}
              w={w}
              h={h}
              userColor={userColor}
              sysColor={sysColor}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function MiniGraphs() {
  const { live } = useStore();
  const cpuNow = live.cpu ? Math.round(live.cpu.userPct + live.cpu.sysPct) : null;
  const mem = live.memory;
  const memNow = mem ? Math.round((mem.usedBytes / mem.totalBytes) * 100) : null;
  // Memory history reuses the stacked-bar chart with a single series in the
  // donut's "used" color.
  const memData = (live.memHistory ?? []).map((pct) => ({ user: pct, sys: 0 }));

  return (
    <div className="sm-pm-graphs">
      <MiniGraph
        title="CPU"
        value={cpuNow != null ? `${cpuNow}%` : "—"}
        data={live.cpu?.history ?? []}
      />
      <MiniGraph
        title="Memory"
        value={
          mem && memNow != null
            ? `${(mem.usedBytes / 1024 ** 3).toFixed(1)} / ${(mem.totalBytes / 1024 ** 3).toFixed(0)} GB (${memNow}%)`
            : "—"
        }
        data={memData}
        userColor={MEM_COLORS.used}
      />
    </div>
  );
}

// ─── Table rows ────────────────────────────────────────────────────────────────

function SessionModalRow({
  row,
  workspaceId,
  settings,
  selected,
  expanded,
  onSelect,
  onToggle,
  onJump,
}: {
  row: SessionRow;
  workspaceId: string;
  settings: Settings;
  selected: boolean;
  expanded: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onJump: (workspaceId: string, row: SessionRow) => void;
}) {
  const hasChildren = row.childCount > 0;
  const flat = expanded && row.tree ? flattenTree(row.tree) : [];
  const leaderName = displayName(row.leader);
  const showLeader = leaderName !== row.title && !row.atPrompt;

  return (
    <>
      <div
        className={"sm-pm-row" + (selected ? " sm-pm-row-selected" : "")}
        onClick={onSelect}
        onDoubleClick={() => row.terminalId && onJump(workspaceId, row)}
        title={row.terminalId ? "Double-click to jump to this terminal" : undefined}
      >
        <div className="sm-pm-cell-name sm-pm-indent-1">
          {hasChildren ? (
            <button
              className="sm-proc-chevron"
              onClick={(e) => { e.stopPropagation(); onToggle(); }}
              aria-label={expanded ? "Collapse" : "Expand"}
            >
              <span
                className={
                  "sm-proc-chevron-glyph" +
                  (expanded ? " sm-proc-chevron-open" : "")
                }
              >
                <ChevronIcon />
              </span>
            </button>
          ) : (
            <span className="sm-pm-leaf-spacer" aria-hidden />
          )}
          <span
            className={
              "sm-pm-name-text" + (row.atPrompt ? " sm-pm-name-idle" : "")
            }
          >
            {row.title}
            {hasChildren && (
              <span className="sm-proc-child-count"> ({row.childCount})</span>
            )}
          </span>
          {showLeader && <span className="sm-pm-leader">{leaderName}</span>}
          {row.atPrompt && <span className="sm-proc-idle-pill">idle</span>}
        </div>
        <div
          className="sm-pm-cell-stat"
          style={heatStyle(row.totalCpuPercent, settings.cpuDangerPercent)}
        >
          {formatCpu(row.totalCpuPercent)}
        </div>
        <div
          className="sm-pm-cell-stat"
          style={heatStyle(row.totalMemoryMb, settings.memDangerMb)}
        >
          {formatMem(row.totalMemoryMb)}
        </div>
      </div>
      {flat.map(({ node, depth }) => (
        <div key={node.pid} className="sm-pm-row sm-pm-row-child">
          <div
            className="sm-pm-cell-name"
            style={{ paddingLeft: 44 + depth * 14 }}
          >
            <span className="sm-pm-name-text sm-pm-child-name">
              {displayName(node.command)}
            </span>
          </div>
          <div
            className="sm-pm-cell-stat"
            style={heatStyle(node.cpuPercent, settings.cpuDangerPercent)}
          >
            {formatCpu(node.cpuPercent)}
          </div>
          <div
            className="sm-pm-cell-stat"
            style={heatStyle(node.memoryMb, settings.memDangerMb)}
          >
            {formatMem(node.memoryMb)}
          </div>
        </div>
      ))}
    </>
  );
}

// ─── Modal ─────────────────────────────────────────────────────────────────────

function AllProcessesModal({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const { settings } = store;
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "cpu", dir: -1 });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const all = store.live.allProcesses;

  function toggleSort(key: SortKey): void {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 1 ? -1 : 1 }
        : { key, dir: DEFAULT_DIR[key] },
    );
  }

  function toggleGroup(workspaceId: string): void {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(workspaceId)) next.delete(workspaceId);
      else next.add(workspaceId);
      return next;
    });
  }

  function toggleTree(sessionId: string): void {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  }

  function jump(workspaceId: string, row: SessionRow): void {
    if (!row.terminalId) return;
    processesController.focusSession(workspaceId, row.terminalId);
    onClose();
  }

  // Groups with sessions, filtered by the query (a workspace-name match keeps
  // the whole group; otherwise rows match on title/leader), sorted per the
  // active column — group order follows the same key via each group's aggregate.
  // Soft-closed workspaces are included unless hideClosedWorkspaces is on.
  const scoped = (all ?? []).filter(
    (ws) => !settings.hideClosedWorkspaces || !ws.closed,
  );
  const q = query.trim().toLowerCase();
  const groups = scoped
    .filter((ws) => ws.data.rows.length > 0)
    .map((ws) => {
      if (!q || ws.name.toLowerCase().includes(q)) return ws;
      const rows = ws.data.rows.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          displayName(r.leader).toLowerCase().includes(q),
      );
      return { ...ws, data: { ...ws.data, rows } };
    })
    .filter((ws) => ws.data.rows.length > 0)
    .sort((a, b) => compareGroups(a, b, sort));

  // Grand totals span every session in the current view scope (respecting
  // hide-closed), independent of the search filter.
  const totals = scoped.reduce(
    (acc, ws) => ({
      sessions: acc.sessions + ws.data.agg.sessions,
      procs: acc.procs + ws.data.agg.procs,
      cpuPercent: acc.cpuPercent + ws.data.agg.cpuPercent,
      memoryMb: acc.memoryMb + ws.data.agg.memoryMb,
    }),
    { sessions: 0, procs: 0, cpuPercent: 0, memoryMb: 0 },
  );

  // Selection survives re-renders by id; resolve it back to a row each pass so
  // the footer buttons disable when the session exits.
  let selectedRow: SessionRow | null = null;
  let selectedWorkspaceId: string | null = null;
  for (const ws of groups) {
    const hit = ws.data.rows.find((r) => r.sessionId === selectedId);
    if (hit) {
      selectedRow = hit;
      selectedWorkspaceId = ws.workspaceId;
      break;
    }
  }

  const arrow = (key: SortKey): string =>
    sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : "";

  return (
    <div className="sm-procmodal">
      <MiniGraphs />

      <input
        className="sm-pm-search"
        type="text"
        placeholder="Filter by name or workspace…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="sm-pm-head">
        <button className="sm-pm-head-cell sm-pm-head-name" onClick={() => toggleSort("name")}>
          <span className="sm-pm-head-total" />
          <span className="sm-pm-head-label">Name{arrow("name")}</span>
        </button>
        <button className="sm-pm-head-cell" onClick={() => toggleSort("cpu")}>
          <span className="sm-pm-head-total">
            {all ? formatCpu(totals.cpuPercent) : "—"}
          </span>
          <span className="sm-pm-head-label">CPU{arrow("cpu")}</span>
        </button>
        <button className="sm-pm-head-cell" onClick={() => toggleSort("mem")}>
          <span className="sm-pm-head-total">
            {all ? formatMem(totals.memoryMb) : "—"}
          </span>
          <span className="sm-pm-head-label">Memory{arrow("mem")}</span>
        </button>
      </div>

      <div className="sm-pm-body">
        {all == null ? (
          <div className="sm-pm-empty">Waiting for data…</div>
        ) : groups.length === 0 ? (
          <div className="sm-pm-empty">
            {q ? "No processes match the filter." : "No terminal sessions in any workspace."}
          </div>
        ) : (
          groups.map((ws) => {
            const isCollapsed = collapsed.has(ws.workspaceId);
            return (
              <div key={ws.workspaceId}>
                <div
                  className="sm-pm-row sm-pm-group-row"
                  onClick={() => toggleGroup(ws.workspaceId)}
                >
                  <div className="sm-pm-cell-name">
                    <span
                      className={
                        "sm-proc-chevron-glyph" +
                        (isCollapsed ? "" : " sm-proc-chevron-open")
                      }
                    >
                      <ChevronIcon />
                    </span>
                    <span className="sm-pm-group-name">
                      {ws.name}
                      <span className="sm-proc-child-count"> ({ws.data.rows.length})</span>
                    </span>
                    {ws.active && (
                      <span className="sm-procmodal-active-pill">active</span>
                    )}
                    {ws.closed && (
                      <span className="sm-procmodal-closed-pill">closed</span>
                    )}
                  </div>
                  <div
                    className="sm-pm-cell-stat"
                    style={heatStyle(ws.data.agg.cpuPercent, settings.cpuDangerPercent)}
                  >
                    {formatCpu(ws.data.agg.cpuPercent)}
                  </div>
                  <div
                    className="sm-pm-cell-stat"
                    style={heatStyle(ws.data.agg.memoryMb, settings.memDangerMb)}
                  >
                    {formatMem(ws.data.agg.memoryMb)}
                  </div>
                </div>
                {!isCollapsed &&
                  [...ws.data.rows]
                    .sort((a, b) => compareRows(a, b, sort))
                    .map((row) => (
                      <SessionModalRow
                        key={row.sessionId}
                        row={row}
                        workspaceId={ws.workspaceId}
                        settings={settings}
                        selected={row.sessionId === selectedId}
                        expanded={expandedIds.has(row.sessionId)}
                        onSelect={() => setSelectedId(row.sessionId)}
                        onToggle={() => toggleTree(row.sessionId)}
                        onJump={jump}
                      />
                    ))}
              </div>
            );
          })
        )}
      </div>

      <div className="sm-pm-footer">
        <label className="sm-pm-hide-closed">
          <input
            type="checkbox"
            checked={settings.hideClosedWorkspaces}
            onChange={(e) =>
              sysmonStore.updateSettings({
                ...settings,
                hideClosedWorkspaces: e.target.checked,
              })
            }
          />
          Hide closed workspaces
        </label>
        <span className="sm-pm-footer-info">
          {all
            ? `${totals.sessions} session${totals.sessions === 1 ? "" : "s"} · ${totals.procs} proc${totals.procs === 1 ? "" : "s"}`
            : ""}
        </span>
        <button
          className="sm-pm-btn"
          disabled={!selectedRow?.terminalId}
          onClick={() =>
            selectedRow && selectedWorkspaceId && jump(selectedWorkspaceId, selectedRow)
          }
        >
          Go to Terminal
        </button>
        <button
          className="sm-pm-btn sm-pm-btn-danger"
          disabled={!selectedRow}
          onClick={() =>
            selectedRow && void processesController.killSession(selectedRow)
          }
        >
          End Task
        </button>
      </div>
    </div>
  );
}
