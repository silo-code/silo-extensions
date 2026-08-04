/**
 * The pure, unit-tested projection layer for the Agents side panel: turns the
 * host-computed {@link AgentInfo} snapshot (`ctx.agents`, unscoped across every
 * loaded workspace) plus the current {@link Workspace} list into the row
 * groups the panel renders, in either of its two views — by status
 * ({@link groupAgentRows}: "ready"/needs-attention, then "working", then
 * "done") or by workspace ({@link groupAgentRowsByWorkspace}). `agents-panel.tsx`
 * is the thin component layer that wires this to React state, the view
 * toggle, and `ctx.terminals.focus`.
 */

import type { AgentActivity, AgentInfo, Workspace } from "@silo-code/sdk";
import { stripStatusMarker } from "./agent-view";

export type AgentSection = "ready" | "working" | "done";

export interface AgentRow {
  terminalId: string;
  workspaceId: string;
  section: AgentSection;
  /** The tab's title (customName, or the OSC title with status markers stripped). */
  title: string;
  workspaceName: string;
  /** Raw host activity, kept so the component can pick a glyph within "done" (idle/error/dead). */
  activity: AgentActivity;
  /** Stable catalog key (e.g. `"claude"`, `"codex"`) for the icon column, or
   * undefined before the host has resolved which agent this is. */
  agentId?: string;
  /**
   * When this row entered its current section — `attentionSince` for "ready",
   * `workingSince` for "working" (both host-owned and restart-durable). For
   * "done", the host doesn't track an equivalent (acknowledged idle, error,
   * dead all clear their own timestamps) — worse, `TerminalRecord
   * .lastActiveAt` looks like a stand-in (its doc says "last output") but
   * isn't actually updated on PTY output; the only write site is
   * `recreateTerminal` (a backend reconnect), so it resets to "now" for
   * reasons unrelated to the agent finishing, which is why using it here
   * briefly produced rows whose duration jumped around. So this comes from
   * {@link updateDoneSince}'s own local tracking instead — see its
   * persistence note for how the "resets on every extension reload" version
   * of that problem is handled.
   */
  since?: string;
}

/**
 * Which section an agent belongs in, or `null` for no row at all — mirrors
 * {@link deriveStatusRow}'s "no row" cases (non-agents, and agents that have
 * never run). `needsAttention` wins regardless of `activity` (an idle agent
 * with a pending finish is "ready", not "done"); everything else that isn't
 * actively `"working"` — acknowledged idle, `error`, `dead` — settles into
 * "done".
 */
function sectionFor(a: AgentInfo): AgentSection | null {
  if (!a.isAgent || a.activity === "none") return null;
  if (a.needsAttention) return "ready";
  if (a.activity === "working") return "working";
  return "done";
}

/**
 * Build the flat row list for every tracked agent that should appear in the
 * panel. Rows whose workspace or terminal record can no longer be found
 * (closed since the agent snapshot was taken) are silently dropped rather
 * than shown with placeholder text. `doneSince` supplies the locally-tracked
 * timestamp for "done" rows (see {@link updateDoneSince}); omit it only where
 * a duration for "done" rows isn't needed.
 */
export function buildAgentRows(
  agents: readonly AgentInfo[],
  workspaces: readonly Workspace[],
  doneSince: ReadonlyMap<string, string> = new Map(),
): AgentRow[] {
  const workspaceById = new Map(workspaces.map((ws) => [ws.id, ws]));
  const rows: AgentRow[] = [];
  for (const a of agents) {
    const section = sectionFor(a);
    if (!section) continue;
    const ws = workspaceById.get(a.workspaceId);
    if (!ws) continue;
    const terminal = ws.terminals.find((t) => t.id === a.terminalId);
    if (!terminal) continue;
    rows.push({
      terminalId: a.terminalId,
      workspaceId: a.workspaceId,
      section,
      title: terminal.customName ?? stripStatusMarker(terminal.title),
      workspaceName: ws.name,
      activity: a.activity,
      agentId: a.agentId,
      since:
        section === "ready"
          ? a.attentionSince
          : section === "working"
            ? a.workingSince
            : doneSince.get(a.terminalId),
    });
  }
  return rows;
}

/**
 * Track "how long has this row been done" locally, since the host doesn't
 * expose an equivalent to `attentionSince`/`workingSince` for "done", and
 * `TerminalRecord.lastActiveAt` isn't a safe substitute (see the caveat on
 * {@link AgentRow.since}). Call on every new {@link AgentInfo} snapshot,
 * threading the previous call's result back in as `prev`: a terminal keeps
 * its first-seen timestamp for as long as it stays "done" *continuously*,
 * and gets re-stamped at `nowIso` the moment it re-enters "done" from another
 * section (ready or working) — including the very first time this extension
 * observes it, since `prev` starts empty.
 *
 * That first-seen moment would be a real gap on its own — a terminal that
 * was already done before this extension started watching would show a
 * duration counted from then, not from whenever it actually finished, and
 * every reload would reset every row to that same freshly-observed instant.
 * `agents-panel.tsx` closes it by persisting this map to `ctx.storage.global`
 * and seeding `prev` from that on mount, so `updateDoneSince` only "starts
 * over" for a row the very first time it's ever seen done, not on every
 * reload.
 */
export function updateDoneSince(
  prev: ReadonlyMap<string, string>,
  agents: readonly AgentInfo[],
  nowIso: string,
): Map<string, string> {
  const next = new Map<string, string>();
  for (const a of agents) {
    if (sectionFor(a) !== "done") continue;
    next.set(a.terminalId, prev.get(a.terminalId) ?? nowIso);
  }
  return next;
}

export const SECTION_ORDER: readonly AgentSection[] = ["ready", "working", "done"];

/**
 * Compact duration since an ISO timestamp — `"45s"`, `"12m"`, `"3h"`, `"2d"` —
 * for the elapsed-time label next to a ready/working row's subtitle (mirrors
 * the host's own `formatElapsed` in the Workspaces panel, reimplemented here
 * since it isn't part of the public SDK surface). Negative durations (clock
 * skew) clamp to `0s` rather than showing a negative number.
 */
export function formatElapsed(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${Math.max(0, sec)}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * Order two rows within a single section: rows with a `since` timestamp sort
 * most-recent-first — i.e. shortest duration first, since a smaller elapsed
 * time means a more recent `since`. (Every row normally carries one once
 * `buildAgentRows` is given a `doneSince` map; the alphabetical-by-title
 * fallback only matters for a caller that omits it.)
 */
function compareRows(x: AgentRow, y: AgentRow): number {
  if (x.since && y.since) return y.since.localeCompare(x.since);
  if (x.since) return -1;
  if (y.since) return 1;
  return x.title.localeCompare(y.title);
}

/**
 * Group rows by section (ready, working, done — in that fixed display order),
 * sorted within each by {@link compareRows}.
 */
export function groupAgentRows(
  rows: readonly AgentRow[],
): Record<AgentSection, AgentRow[]> {
  const groups: Record<AgentSection, AgentRow[]> = {
    ready: [],
    working: [],
    done: [],
  };
  for (const row of rows) groups[row.section].push(row);
  for (const section of SECTION_ORDER) {
    groups[section].sort(compareRows);
  }
  return groups;
}

export interface WorkspaceGroup {
  workspaceId: string;
  workspaceName: string;
  rows: AgentRow[];
}

/**
 * Group rows by workspace instead of by section — the alternate "Workspace"
 * view. Workspace groups sort alphabetically by name (the SDK's
 * `WorkspaceService` doesn't expose the host's user-dragged panel order to
 * extensions, so alphabetical is the only stable, predictable choice here).
 * Within a workspace, rows still sort ready-before-working-before-done (via
 * {@link SECTION_ORDER}), then by {@link compareRows} — so the state that
 * needs your attention most doesn't get buried under an unrelated grouping.
 */
export function groupAgentRowsByWorkspace(
  rows: readonly AgentRow[],
): WorkspaceGroup[] {
  const byWorkspace = new Map<string, WorkspaceGroup>();
  for (const row of rows) {
    let group = byWorkspace.get(row.workspaceId);
    if (!group) {
      group = {
        workspaceId: row.workspaceId,
        workspaceName: row.workspaceName,
        rows: [],
      };
      byWorkspace.set(row.workspaceId, group);
    }
    group.rows.push(row);
  }
  const groups = [...byWorkspace.values()];
  for (const group of groups) {
    group.rows.sort(
      (x, y) =>
        SECTION_ORDER.indexOf(x.section) - SECTION_ORDER.indexOf(y.section) ||
        compareRows(x, y),
    );
  }
  groups.sort((a, b) => a.workspaceName.localeCompare(b.workspaceName));
  return groups;
}
