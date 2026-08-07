import { useEffect, useRef, useState } from "react";
import { CaretRight } from "@phosphor-icons/react";
import type { Activity, ExtensionContext, MenuEntry } from "@silo-code/sdk";
import { ActivityGlyph, Badge, useServiceState } from "@silo-code/sdk";
import {
  buildAgentRows,
  formatElapsed,
  groupAgentRows,
  groupAgentRowsByWorkspace,
  isAtLeastHoursOld,
  SECTION_ORDER,
  type AgentRow,
  type AgentSection,
} from "./agents-panel-view";
import { getDoneSince } from "./done-since";
import { AgentIconGlyph } from "./AgentIconGlyph";
import { settingsService, type IconMode } from "./settings-store";

/** Ticks the panel so a rendered `formatElapsed` duration stays live. 1s
 * matches the host's own Workspaces-panel elapsed-time refresh. */
function useNow(intervalMs: number): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (intervalMs <= 0) return;
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}

const SECTION_LABELS: Record<AgentSection, string> = {
  ready: "Ready",
  working: "Working",
  // The host's own term for the state is idle — an agent that has stopped
  // working and isn't waiting on you. "Done" implied a finished task rather
  // than a session sitting there.
  done: "Idle",
};

/** Which axis the panel sections its rows by — one registered Navigator view
 * per value (see `registerNavigatorView` in index.tsx). */
export type GroupMode = "status" | "workspace";

/** A section as the render below wants it, regardless of which grouping
 * produced it: a heading, its rows, and where each row's subtitle (the line
 * under the title) comes from — whichever axis isn't already the heading. */
export interface PanelSection {
  key: string;
  header: string;
  rows: AgentRow[];
  subtitle: (row: AgentRow) => string;
  /** Whether the render below collapses this heading's rows by default,
   * revealing them only while the section is hovered — only the "N+ hours
   * old" heading does, since it's the one that piles up with rows you're
   * least likely to still care about. */
  collapsible?: boolean;
}

// Stable key for the "N+ hours old" section — both what buildStatusSections
// tags it with and what the render below checks to apply the hover reveal.
const STALE_DONE_SECTION_KEY = "stale-done";

/**
 * Whether the "N+ hours old" heading should start open rather than waiting for
 * a hover. With nothing ready, working or idle it is the only content the view
 * has, and a panel showing three empty headings plus a collapsed one reads as
 * empty — the user shouldn't have to hover to discover it isn't.
 */
export function staleSectionStartsExpanded(
  sections: readonly PanelSection[],
): boolean {
  return sections.every(
    (s) => s.key === STALE_DONE_SECTION_KEY || s.rows.length === 0,
  );
}

function isStaleDone(row: AgentRow, staleDoneHours: number): boolean {
  return row.since !== undefined && isAtLeastHoursOld(row.since, staleDoneHours);
}

/**
 * `staleDoneEnabled`/`staleDoneHours` are the settings-configurable split
 * (see `DEFAULT_STALE_DONE_ENABLED`/`DEFAULT_STALE_DONE_HOURS`/
 * `MIN_STALE_DONE_HOURS` in `./settings-store`): while enabled, a "done" row
 * sitting for at least `staleDoneHours` drops out of the Done heading into
 * its own "N+ hours old" one, clearing space in Done for finishes still
 * worth a glance without losing the older ones entirely. Disabled, every
 * done row just stays in Done and the extra heading doesn't appear at all.
 */
export function buildStatusSections(
  rows: readonly AgentRow[],
  staleDoneEnabled: boolean,
  staleDoneHours: number,
): PanelSection[] {
  const groups = groupAgentRows(rows);
  const subtitle = (row: AgentRow) => row.workspaceName;
  const statusSections = SECTION_ORDER.map((section) => ({
    key: section,
    header: SECTION_LABELS[section],
    rows:
      section === "done" && staleDoneEnabled
        ? groups.done.filter((row) => !isStaleDone(row, staleDoneHours))
        : groups[section],
    subtitle,
  }));
  if (!staleDoneEnabled) return statusSections;
  return [
    ...statusSections,
    {
      key: STALE_DONE_SECTION_KEY,
      header: `${staleDoneHours}+ hours old`,
      rows: groups.done.filter((row) => isStaleDone(row, staleDoneHours)),
      subtitle,
      collapsible: true,
    },
  ];
}

export function buildWorkspaceSections(rows: readonly AgentRow[]): PanelSection[] {
  return groupAgentRowsByWorkspace(rows).map((group) => ({
    key: group.workspaceId,
    header: group.workspaceName,
    rows: group.rows,
    subtitle: (row) => SECTION_LABELS[row.section],
  }));
}

/** The glyph for a row's section — "done" still distinguishes error/dead from
 * a plain acknowledged-idle finish (which gets the neutral gray dot). */
function glyphFor(row: AgentRow): Activity | undefined {
  switch (row.section) {
    case "ready":
      return "ready";
    case "working":
      return "working";
    case "done":
      if (row.activity === "error") return "error";
      if (row.activity === "dead") return "warn";
      return undefined;
  }
}

function AgentRowItem({
  row,
  subtitle,
  active,
  iconMode,
  onFocus,
  onContextMenu,
}: {
  row: AgentRow;
  /** Workspace name in the "by status" view; status label in the "by
   * workspace" view — whichever isn't already the enclosing section header. */
  subtitle: string;
  active: boolean;
  iconMode: IconMode;
  onFocus: (terminalId: string) => void;
  onContextMenu: (row: AgentRow, at: { x: number; y: number }) => void;
}) {
  return (
    <div
      className={active ? "ap-row active" : "ap-row"}
      role="option"
      aria-selected={active}
      tabIndex={0}
      onClick={() => onFocus(row.terminalId)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onFocus(row.terminalId);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(row, { x: e.clientX, y: e.clientY });
      }}
    >
      <ActivityGlyph activity={glyphFor(row)} className="ap-row-glyph" />
      <div className="ap-row-text">
        <span className="ap-row-title-line">
          <AgentIconGlyph agentId={row.agentId} mode={iconMode} className="ap-row-icon" />
          <span className="ap-row-title">{row.title}</span>
        </span>
        <span className="ap-row-subtitle">
          <span className="ap-row-workspace">{subtitle}</span>
          {row.since && (
            <>
              <span className="ap-row-sep">·</span>
              <span className="ap-row-elapsed">{formatElapsed(row.since)}</span>
            </>
          )}
        </span>
      </div>
    </div>
  );
}

export function AgentsPanel({
  ctx,
  mode,
  active,
}: {
  ctx: ExtensionContext;
  mode: GroupMode;
  /** False while this view is mounted but off screen — the 1s elapsed-time
   * tick is the only per-second work here, so parking it is the whole win. */
  active: boolean;
}) {
  // 1s so formatElapsed's seconds-resolution display (<1 minute) ticks live;
  // rows past a minute don't strictly need it, but the tick is cheap.
  useNow(active ? 1_000 : 0);

  const [, setTick] = useState(0);
  useEffect(
    () =>
      ctx.agents.subscribe(() => setTick((t) => t + 1), { allWorkspaces: true })
        .dispose,
    [ctx.agents],
  );
  useEffect(
    () => ctx.workspaces.subscribe(() => setTick((t) => t + 1)).dispose,
    [ctx.workspaces],
  );

  // The terminal currently focused in the center dock, wherever its
  // workspace — `getActive`/`subscribeActive` return a single, globally
  // unique terminal id, so a plain equality check is enough to mark its row.
  const [activeTerminalId, setActiveTerminalId] = useState(() =>
    ctx.terminals.getActive(),
  );
  useEffect(
    () => ctx.terminals.subscribeActive(setActiveTerminalId).dispose,
    [ctx.terminals],
  );

  const { iconMode, staleDoneEnabled, staleDoneHours } =
    useServiceState(settingsService);

  // The "N+ hours old" section starts collapsed and reveals its rows only
  // while the mouse is over it — attached to the section's own container
  // (not the heading), so a click on a row inside it (which doesn't move the
  // mouse) never collapses it mid-click; only actually leaving the section
  // does.
  //
  // Collapse is debounced rather than instant: WebKit (and Chromium) re-hit-test
  // and fire mouseleave/mouseenter transitions on scroll, not just on real
  // pointer movement, so scrolling the panel with the cursor sitting still over
  // this section can momentarily "leave" it mid-scroll. Without the delay that
  // collapsed the section — and shrank ap-body's scroll height — before the
  // user could ever scroll down into the rows they'd just revealed. A leave
  // that's immediately followed by a re-enter (the common case while scrolling
  // through the section's own rows) cancels the pending collapse; only a leave
  // that sticks around actually collapses it.
  const [staleHovered, setStaleHovered] = useState(false);
  const staleCollapseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (staleCollapseTimeoutRef.current !== null) {
        clearTimeout(staleCollapseTimeoutRef.current);
      }
    },
    [],
  );
  function handleStaleMouseEnter() {
    if (staleCollapseTimeoutRef.current !== null) {
      clearTimeout(staleCollapseTimeoutRef.current);
      staleCollapseTimeoutRef.current = null;
    }
    setStaleHovered(true);
  }
  function handleStaleMouseLeave() {
    staleCollapseTimeoutRef.current = setTimeout(() => {
      staleCollapseTimeoutRef.current = null;
      setStaleHovered(false);
    }, 300);
  }

  const agentsSnapshot = ctx.agents.getState({ allWorkspaces: true });
  // "Done since" is tracked at extension scope (see ./done-since) rather than
  // here: both views read the same stamps, and tracking has to keep running
  // whichever view — if any — the user has open.
  const rows = buildAgentRows(
    agentsSnapshot,
    ctx.workspaces.getState().all,
    getDoneSince(),
  );

  const sections =
    mode === "workspace"
      ? buildWorkspaceSections(rows)
      : buildStatusSections(rows, staleDoneEnabled, staleDoneHours);

  const staleStartsExpanded = staleSectionStartsExpanded(sections);

  function openRowMenu(row: AgentRow, at: { x: number; y: number }) {
    const items: MenuEntry[] = [];
    // Only a row that's actually flagged has anything to acknowledge —
    // `acknowledge` is a host-side no-op otherwise, and an always-present row
    // that usually does nothing is worse than one that comes and goes.
    if (row.section === "ready") {
      items.push({
        label: "Mark as seen",
        run: () => ctx.agents.acknowledge(row.terminalId),
      });
      items.push({ type: "separator" });
    }

    // Rename… and any `terminal/tab` contributions — the same rows the
    // terminal's own tab offers, rather than a menu that drifts from it.
    items.push(...ctx.terminals.getTabMenuItems(row.terminalId));

    // The workspace this agent is running in. A submenu rather than inline
    // because rows span every workspace in the Agents view, so the actions
    // need to say which one they apply to.
    const workspaceItems = ctx.workspaces.getWorkspaceMenuItems(row.workspaceId);
    if (workspaceItems.length > 0) {
      if (items.length > 0) items.push({ type: "separator" });
      items.push({ label: row.workspaceName, submenu: workspaceItems });
    }

    if (items.length > 0) items.push({ type: "separator" });
    items.push({
      label: "Close terminal",
      danger: true,
      run: () => {
        void (async () => {
          const ok = await ctx.ui.confirm({
            title: "Close terminal?",
            body: `"${row.title}" and anything running in it will be stopped.`,
            confirmLabel: "Close",
            danger: true,
          });
          if (ok) ctx.terminals.close(row.terminalId);
        })();
      },
    });

    void ctx.ui.showMenu({ items, at, toggle: false });
  }

  // Only the workspace grouping can produce zero sections (no workspace to
  // group by) — the status grouping always has its three fixed headings, even
  // with no agents at all, so it never hits this.
  if (sections.length === 0) {
    return (
      <div className="ap-panel">
        <div className="ap-body">
          <div className="ap-empty">
            <p>No agents running.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ap-panel">
      <div className="ap-body">
        {sections.map((section) => {
          const isStaleSection = section.key === STALE_DONE_SECTION_KEY;
          const expanded =
            !isStaleSection || staleHovered || staleStartsExpanded;
          return (
            <div
              key={section.key}
              className="ap-section"
              onMouseEnter={isStaleSection ? handleStaleMouseEnter : undefined}
              onMouseLeave={isStaleSection ? handleStaleMouseLeave : undefined}
            >
              {/* Every heading carries its row count. The status grouping's
                  three headings are fixed and so are often empty — a `0` says
                  "nothing ready" in less space than a placeholder row. */}
              <div className="ap-section-title">
                {isStaleSection && (
                  <CaretRight
                    size="0.7em"
                    weight="bold"
                    className={expanded ? "ap-section-caret expanded" : "ap-section-caret"}
                  />
                )}
                {section.header}
                <Badge size="sm" className="ap-section-count">
                  {section.rows.length}
                </Badge>
              </div>
              {expanded &&
                section.rows.map((row) => (
                  <AgentRowItem
                    key={row.terminalId}
                    row={row}
                    subtitle={section.subtitle(row)}
                    active={row.terminalId === activeTerminalId}
                    iconMode={iconMode}
                    onFocus={(terminalId) => ctx.terminals.focus(terminalId)}
                    onContextMenu={openRowMenu}
                  />
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
