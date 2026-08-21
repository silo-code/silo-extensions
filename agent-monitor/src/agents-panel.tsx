import { useEffect, useRef, useState, type DragEvent } from "react";
import { CaretRight, DotsSixVertical } from "@phosphor-icons/react";
import type { Activity, ExtensionContext, MenuEntry } from "@silo-code/sdk";
import { ActivityGlyph, Badge, useServiceState } from "@silo-code/sdk";
import {
  buildAgentRows,
  compareRows,
  formatElapsed,
  groupAgentRows,
  groupAgentRowsByWorkspace,
  isAtLeastHoursOld,
  moveItem,
  orderAgeRows,
  SECTION_ORDER,
  type AgentRow,
  type AgentSection,
} from "./agents-panel-view";
import { getDoneSince } from "./done-since";
import { manualOrderService } from "./manual-order";
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

/**
 * The "Recent" view (internal `groupBy` value `"age"`): unlike status or
 * workspace grouping, every row sits in one flat, unheaded-by-status list —
 * no status or workspace bucketing above it. Rows the user hasn't
 * drag-reordered sort by {@link compareRows} (most recently changed first);
 * `manualOrder` (see `./manual-order`) carries whatever order a drag left
 * behind for the rest — see {@link orderAgeRows} for exactly how the two mix.
 * The one exception, drag or no drag, is the same "N+ hours old" split
 * `buildStatusSections` uses: a done row that's sat past `staleDoneHours`
 * still peels off into its own collapsible heading (tagged with the same
 * `STALE_DONE_SECTION_KEY`, so the panel's existing hover-to-reveal behavior
 * applies unchanged, and it stays un-reorderable — see `agents-panel.tsx`'s
 * render, which only wires drag handlers for `key === "age"`), since burying
 * genuinely stale rows among fresh ones defeats the point of this view.
 *
 * Because {@link compareRows} orders by the fixed `since` timestamp rather
 * than an elapsed duration recomputed on every render, an undragged row's
 * position never shifts on its own as time passes — only its displayed
 * elapsed label does — so a row stays put unless its actual state changes or
 * the user drags it.
 */
export function buildAgeSections(
  rows: readonly AgentRow[],
  staleDoneEnabled: boolean,
  staleDoneHours: number,
  manualOrder: readonly string[],
): PanelSection[] {
  const subtitle = (row: AgentRow) => `${SECTION_LABELS[row.section]} · ${row.workspaceName}`;
  const isStale = (row: AgentRow) =>
    staleDoneEnabled && row.section === "done" && isStaleDone(row, staleDoneHours);
  const activeRows = orderAgeRows(rows.filter((row) => !isStale(row)), manualOrder);
  // No heading: the view's own title already says "Agents" — a heading here
  // would just restate it, unlike the by-status/by-workspace views where the
  // heading carries real information (which status, which workspace).
  const ageSection: PanelSection = {
    key: "age",
    header: "",
    rows: activeRows,
    subtitle,
  };
  if (!staleDoneEnabled) return [ageSection];
  return [
    ageSection,
    {
      key: STALE_DONE_SECTION_KEY,
      header: `${staleDoneHours}+ hours old`,
      rows: rows.filter(isStale).slice().sort(compareRows),
      subtitle,
      collapsible: true,
    },
  ];
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

/** Drag affordance for a row, wired only in the "Recent" view's flat,
 * non-stale section (see `AgentsPanel`'s render — the stale section and the
 * status/workspace views never pass this). */
interface RowDrag {
  dragging: boolean;
  dropTarget: boolean;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDrop: () => void;
  onDragEnd: () => void;
}

function AgentRowItem({
  row,
  subtitle,
  active,
  iconMode,
  onFocus,
  onContextMenu,
  drag,
}: {
  row: AgentRow;
  /** Workspace name in the "by status" view; status label in the "by
   * workspace" view — whichever isn't already the enclosing section header. */
  subtitle: string;
  active: boolean;
  iconMode: IconMode;
  onFocus: (terminalId: string) => void;
  onContextMenu: (row: AgentRow, at: { x: number; y: number }) => void;
  drag?: RowDrag;
}) {
  const classNames = ["ap-row"];
  if (active) classNames.push("active");
  if (drag?.dragging) classNames.push("ap-row-dragging");
  if (drag?.dropTarget) classNames.push("ap-row-drop-target");
  return (
    <div
      className={classNames.join(" ")}
      role="option"
      aria-selected={active}
      tabIndex={0}
      draggable={drag !== undefined}
      onDragStart={drag?.onDragStart}
      onDragOver={drag?.onDragOver}
      onDrop={drag?.onDrop}
      onDragEnd={drag?.onDragEnd}
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
      {/* Hover-only affordance on the row's right edge — drag itself works
          from anywhere on the row (native HTML5 drag needs `draggable` on a
          real element, and restricting the drag source to just this icon
          would drag a tiny glyph instead of the row), this is purely the
          visual cue that the row is draggable. */}
      {drag && (
        <span className="ap-row-grip" aria-hidden title="Drag to reorder">
          <DotsSixVertical size={14} weight="bold" />
        </span>
      )}
    </div>
  );
}

export function AgentsPanel({
  ctx,
  active,
}: {
  ctx: ExtensionContext;
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

  // `groupBy` is a setting rather than a prop now: the two groupings were two
  // registered Navigator views until SDK 0.34, and are one view with a
  // "View by" header control since.
  const { iconMode, groupBy, staleDoneEnabled, staleDoneHours } =
    useServiceState(settingsService);

  // The "Recent" view's persisted drag order (see ./manual-order) — reactive
  // for the same reason `groupBy` above is: a drag anywhere in this
  // component has to show up immediately, not just on the next unrelated
  // re-render.
  const manualOrder = useServiceState(manualOrderService);

  // Drag-to-reorder state for the "Recent" view's flat section only — a ref
  // for the dragged index (native `dragstart` fires outside React's render
  // cycle, so nothing needs to *rerender* just because it changed) and state
  // for the hovered drop target (which does need to rerender, to move the
  // drop-target styling as the drag crosses rows). Mirrors
  // `system-monitor`'s `DraggableSection`.
  const dragIndexRef = useRef<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  function handleAgeDragStart(e: DragEvent<HTMLDivElement>, index: number, terminalId: string) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", terminalId);
    // WebKit's *implicit* drag image (the one it builds on its own from a
    // `draggable` element with no explicit `setDragImage` call) only
    // reliably rasterizes simple children here — the status dot renders, but
    // the flex/ellipsis-heavy text column and the row's own background come
    // out blank. Calling `setDragImage` explicitly with the row's own node
    // forces WebKit through its *explicit* snapshot path instead, which
    // paints the row as it actually looks. The offset keeps the image
    // anchored under the cursor at the same point the user grabbed it,
    // rather than snapping to the row's top-left corner.
    const rowEl = e.currentTarget;
    const rect = rowEl.getBoundingClientRect();
    e.dataTransfer.setDragImage(rowEl, e.clientX - rect.left, e.clientY - rect.top);
    dragIndexRef.current = index;
  }
  function handleAgeDragOver(e: DragEvent<HTMLDivElement>, index: number) {
    e.preventDefault();
    if (
      dragIndexRef.current !== null &&
      dragIndexRef.current !== index &&
      dropTargetIndex !== index
    ) {
      setDropTargetIndex(index);
    }
  }
  function handleAgeDrop(index: number, sectionRows: readonly AgentRow[]) {
    const from = dragIndexRef.current;
    if (from !== null && from !== index) {
      // The whole visible order becomes the new manual order, not just the
      // two swapped rows — so a row that was sorting purely by recency (not
      // yet in `manualOrder`) gets carried into it too, exactly where it
      // was sitting when the drag happened.
      manualOrderService.set(
        moveItem(
          sectionRows.map((r) => r.terminalId),
          from,
          index,
        ),
      );
    }
    resetAgeDrag();
  }
  function resetAgeDrag() {
    dragIndexRef.current = null;
    setDropTargetIndex(null);
  }

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
    groupBy === "workspace"
      ? buildWorkspaceSections(rows)
      : groupBy === "age"
        ? buildAgeSections(rows, staleDoneEnabled, staleDoneHours, manualOrder)
        : buildStatusSections(rows, staleDoneEnabled, staleDoneHours);

  const staleStartsExpanded = staleSectionStartsExpanded(sections);

  // Trim `manualOrder` once a dragged row drops out of the flat section for
  // good (terminal closed, or it aged into "N+ hours old") — otherwise
  // storage would carry that id forever. `orderAgeRows` already treats a
  // manual-order id with no matching row as inert, so this is pure
  // housekeeping, not correctness: it only ever removes ids, never changes
  // display order.
  useEffect(() => {
    if (groupBy !== "age") return;
    const flatIds = new Set(
      sections.find((s) => s.key === "age")?.rows.map((r) => r.terminalId),
    );
    const trimmed = manualOrder.filter((id) => flatIds.has(id));
    if (trimmed.length !== manualOrder.length) manualOrderService.set(trimmed);
  });

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
          const isDraggableSection = section.key === "age";
          const expanded =
            !isStaleSection || staleHovered || staleStartsExpanded;
          return (
            <div
              key={section.key}
              className="ap-section"
              onMouseEnter={isStaleSection ? handleStaleMouseEnter : undefined}
              onMouseLeave={isStaleSection ? handleStaleMouseLeave : undefined}
              onDragLeave={isDraggableSection ? () => setDropTargetIndex(null) : undefined}
            >
              {/* Every heading carries its row count. The status grouping's
                  three headings are fixed and so are often empty — a `0` says
                  "nothing ready" in less space than a placeholder row. An
                  empty `header` (the "Recent" view's flat list) skips the
                  heading row entirely — "Agents" would only restate the
                  view's own title. */}
              {section.header !== "" && (
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
              )}
              {expanded &&
                section.rows.map((row, i) => (
                  <AgentRowItem
                    key={row.terminalId}
                    row={row}
                    subtitle={section.subtitle(row)}
                    active={row.terminalId === activeTerminalId}
                    iconMode={iconMode}
                    onFocus={(terminalId) => ctx.terminals.focus(terminalId)}
                    onContextMenu={openRowMenu}
                    drag={
                      isDraggableSection
                        ? {
                            dragging: dragIndexRef.current === i,
                            dropTarget: dropTargetIndex === i,
                            onDragStart: (e) => handleAgeDragStart(e, i, row.terminalId),
                            onDragOver: (e) => handleAgeDragOver(e, i),
                            onDrop: () => handleAgeDrop(i, section.rows),
                            onDragEnd: resetAgeDrag,
                          }
                        : undefined
                    }
                  />
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
