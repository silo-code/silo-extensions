import { useEffect, useRef, useState } from "react";
import { CaretRight, FunnelSimple } from "@phosphor-icons/react";
import type { Activity, ExtensionContext, ExtensionStorage } from "@silo-code/sdk";
import { ActivityGlyph, Badge, IconButton, Tooltip, useServiceState } from "@silo-code/sdk";
import {
  buildAgentRows,
  formatElapsed,
  groupAgentRows,
  groupAgentRowsByWorkspace,
  isAtLeastHoursOld,
  SECTION_ORDER,
  updateDoneSince,
  type AgentRow,
  type AgentSection,
} from "./agents-panel-view";
import { AgentIconGlyph } from "./AgentIconGlyph";
import { settingsService, type GroupBy, type IconMode } from "./settings-store";

/** Ticks the panel so a rendered `formatElapsed` duration stays live. 1s
 * matches the host's own Workspaces-panel elapsed-time refresh. */
function useNow(intervalMs: number): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}

// `updateDoneSince`'s map, persisted so its "first time this row was seen
// done" timestamps survive an extension reload or app restart — without
// this, every reload would re-stamp every currently-done row as "just now"
// (see the caveat on `AgentRow.since`). A plain object, not a Map: storage
// values round-trip through JSON.
const DONE_SINCE_STORAGE_KEY = "agentsDoneSince";

function loadDoneSince(storage: ExtensionStorage): Map<string, string> {
  const stored = storage.get<Record<string, string>>(DONE_SINCE_STORAGE_KEY, {});
  return new Map(Object.entries(stored));
}

function persistDoneSince(storage: ExtensionStorage, map: ReadonlyMap<string, string>): void {
  storage.set(DONE_SINCE_STORAGE_KEY, Object.fromEntries(map));
}

const SECTION_LABELS: Record<AgentSection, string> = {
  ready: "Ready",
  working: "Working",
  done: "Done",
};
const GROUP_BY_OPTIONS: { id: GroupBy; label: string }[] = [
  { id: "status", label: "Status" },
  { id: "workspace", label: "Workspace" },
];

/** A section as the render below wants it, regardless of which grouping
 * produced it: a heading, its rows, and where each row's subtitle (the line
 * under the title) comes from — whichever axis isn't already the heading. */
interface PanelSection {
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

function buildWorkspaceSections(rows: readonly AgentRow[]): PanelSection[] {
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
}: {
  row: AgentRow;
  /** Workspace name in the "by status" view; status label in the "by
   * workspace" view — whichever isn't already the enclosing section header. */
  subtitle: string;
  active: boolean;
  iconMode: IconMode;
  onFocus: (terminalId: string) => void;
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

export function AgentsPanel({ ctx }: { ctx: ExtensionContext }) {
  // 1s so formatElapsed's seconds-resolution display (<1 minute) ticks live;
  // rows past a minute don't strictly need it, but the tick is cheap.
  useNow(1_000);

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

  const { groupBy, iconMode, staleDoneEnabled, staleDoneHours } =
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
  // The host doesn't expose a timestamp for how long a row has been "done"
  // (unlike ready/working) — updateDoneSince tracks it locally instead, fed
  // back into itself across renders via this ref, seeded from persisted
  // storage on mount so a reload doesn't reset every row to "just now". Safe
  // to recompute on every render (including the 1s tick): an id already
  // present keeps its original stamp, so this only ever *adds* a fresh one,
  // never overwrites.
  const doneSinceRef = useRef<Map<string, string> | null>(null);
  if (doneSinceRef.current === null) {
    doneSinceRef.current = loadDoneSince(ctx.storage.global);
  }
  const doneSince = updateDoneSince(
    doneSinceRef.current,
    agentsSnapshot,
    new Date().toISOString(),
  );
  doneSinceRef.current = doneSince;

  const rows = buildAgentRows(agentsSnapshot, ctx.workspaces.getState().all, doneSince);

  // Persist only when the map's contents actually changed — the dep array is
  // a content signature (not `doneSince` itself, which is a new object every
  // render, including the 1s tick that never changes what's in it) so this
  // effect skips the vast majority of renders instead of writing on each one.
  const doneSinceSignature = JSON.stringify([...doneSince].sort());
  useEffect(() => {
    persistDoneSince(ctx.storage.global, doneSince);
    // doneSinceSignature is deliberately the only dep — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneSinceSignature]);

  const menuAnchorRef = useRef<HTMLSpanElement>(null);
  function openGroupByMenu() {
    void ctx.ui.showMenu({
      items: [
        { type: "header", label: "Group by" },
        ...GROUP_BY_OPTIONS.map((opt) => ({
          label: opt.label,
          checked: groupBy === opt.id,
          run: () => settingsService.set({ groupBy: opt.id }),
        })),
      ],
      anchor: menuAnchorRef.current,
      align: "end",
    });
  }
  // Anchors the popover — IconButton isn't ref-forwarding, so the wrapping
  // span (not the button itself) is what showMenu hangs the menu off of.
  const viewMenuButton = (
    <span ref={menuAnchorRef} className="ap-view-menu">
      <Tooltip content="Group by">
        <IconButton
          size="sm"
          aria-label="Change agent grouping"
          onClick={openGroupByMenu}
        >
          <FunnelSimple size="1em" />
        </IconButton>
      </Tooltip>
    </span>
  );

  const sections =
    groupBy === "workspace"
      ? buildWorkspaceSections(rows)
      : buildStatusSections(rows, staleDoneEnabled, staleDoneHours);

  // Only the workspace grouping can produce zero sections (no workspace to
  // group by) — the status grouping always has its three fixed headings, even
  // with no agents at all, so it never hits this.
  if (sections.length === 0) {
    return (
      <div className="ap-panel">
        {viewMenuButton}
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
      {viewMenuButton}
      <div className="ap-body">
        {sections.map((section) => {
          const isStaleSection = section.key === STALE_DONE_SECTION_KEY;
          const expanded = !isStaleSection || staleHovered;
          return (
            <div
              key={section.key}
              className="ap-section"
              onMouseEnter={isStaleSection ? handleStaleMouseEnter : undefined}
              onMouseLeave={isStaleSection ? handleStaleMouseLeave : undefined}
            >
              <div className="ap-section-title">
                {isStaleSection && (
                  <CaretRight
                    size="0.7em"
                    weight="bold"
                    className={expanded ? "ap-section-caret expanded" : "ap-section-caret"}
                  />
                )}
                {section.header}
                {isStaleSection && !expanded && section.rows.length > 0 && (
                  <Badge className="ap-section-count">{section.rows.length}</Badge>
                )}
              </div>
              {expanded &&
                (section.rows.length === 0 ? (
                  <div className="ap-section-empty">—</div>
                ) : (
                  section.rows.map((row) => (
                    <AgentRowItem
                      key={row.terminalId}
                      row={row}
                      subtitle={section.subtitle(row)}
                      active={row.terminalId === activeTerminalId}
                      iconMode={iconMode}
                      onFocus={(terminalId) => ctx.terminals.focus(terminalId)}
                    />
                  ))
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
