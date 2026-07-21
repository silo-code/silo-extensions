/**
 * Owns per-terminal agent-status tracking: OSC subscriptions, the two
 * debounce timers, dispatch through agent-status.ts's `reduce()`, and
 * persistence to `ctx.storage.global`. `index.tsx` only wires the resulting
 * `states` map into its `ctx.*` registrations and disposes the tracker at
 * deactivation — all the tracking logic lives here.
 */

import type { ExtensionContext } from "@silo-code/sdk";
import {
  AGENT_DETECTORS,
  detectCursorAgentOutput,
  detectCodexIdleAfterWorking,
  detectFromOscTitle,
} from "./osc-detectors";
import {
  reduce,
  isLiveSignal,
  restoreState,
  toPersisted,
  type Activity,
  type AgentEvent,
  type EventSource,
  type PersistedAgentState,
  type TerminalAgentState,
} from "./agent-status";
import { settingsService } from "./settings-store";
import { maybePlayTransitionSound } from "./sound";

// Set to true to log OSC events and state transitions to the browser console.
// Open devtools in Silo with Cmd+Option+I (Mac) or F12.
const DEBUG = false;

function log(...args: unknown[]) {
  if (DEBUG) console.log("[agent-monitor]", ...args);
}

// Prefix for the per-terminal persisted-state keys in ctx.storage.global,
// namespacing them away from settings keys (e.g. "hideStatusWhenFocused") in
// the same bag.
function stateStorageKey(terminalId: string): string {
  return `agentState:${terminalId}`;
}

// The actual storage envelope: agent-status.ts's PersistedAgentState plus a
// lastSeenAt heartbeat. lastSeenAt is bookkeeping for detecting an
// app-closed gap on restart (see restoreState's `gapMs` param) — it isn't
// part of the agent-status model itself, so it's tracked here rather than
// folded into PersistedAgentState.
interface StoredTerminalState {
  state: PersistedAgentState;
  lastSeenAt: string;
}

// Per-terminal debounce timer for OSC 133 "working" → "waiting" fallback.
// Some agents (e.g. pi) emit 133;C for each step but never emit 133;A/D on
// completion. When the stream goes silent for SHELL_IDLE_MS we clear to waiting.
const SHELL_IDLE_MS = 3_000;
// Pending debounced ✳ → "waiting" transitions. Claude Code emits ✳ briefly
// between tool calls while computing the next action. The timer is cancelled
// when the next braille-spinner OSC (working) arrives, so we only transition
// to "waiting" if no working signal appears within AGENT_IDLE_DEBOUNCE_MS.
const AGENT_IDLE_DEBOUNCE_MS = 1_500;

export interface TerminalTracker {
  /** Per-terminal agent state, keyed by terminal record id — the single
   * source of truth the status-row and tab-decoration providers read from. */
  states: Map<string, TerminalAgentState>;
  /** The currently active terminal id, updated on every subscribeActive event. */
  activeTerminalId: string | null;
  dispose(): void;
}

export function createTerminalTracker(ctx: ExtensionContext): TerminalTracker {
  const storage = ctx.storage.global;
  const states = new Map<string, TerminalAgentState>();
  // Last time we observed a live, non-timer agent/shell OSC signal for a
  // terminal — updated on every matched detector result, even when it
  // doesn't change status (Claude's braille spinner repeats every animation
  // frame while genuinely still working). This is the heartbeat restoreState()
  // uses at the next activation to tell "app was closed a while" apart from
  // "we were alive a second ago."
  const lastSeenAt = new Map<string, string>();
  // Terminals whose status has been confirmed by a live OSC signal or by
  // seeding from the host's current title. Async storage hydration must not
  // overwrite these — `ctx.storage` may deliver a stale blob after title
  // seed already corrected a restored "working" to "waiting".
  const confirmed = new Set<string>();
  // Disposables for per-terminal OSC subscriptions, keyed by terminal id.
  const oscSubs = new Map<string, { dispose(): void }>();
  // Raw-PTY output subscriptions — Cursor Agent spinner fallback when OSC
  // status titles are disabled (showStatusIndicators: false).
  const outputSubs = new Map<string, { dispose(): void }>();
  // sessionId that was current when each OSC subscription was established.
  // An empty string means "subscribed while the PTY hadn't spawned yet".
  // When the sessionId changes (PTY spawns or restarts), we re-subscribe.
  const oscSubSessionIds = new Map<string, string>();
  const shellIdleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const agentIdleTimers = new Map<string, ReturnType<typeof setTimeout>>();

  let activeTerminalId = ctx.terminals.getActive();
  // When true, skip the working→waiting chime — used while seeding from a
  // restored title so reloading the extension doesn't ding for a correction.
  let suppressTransitionSound = false;

  function persistState(terminalId: string, state: TerminalAgentState) {
    const stored: StoredTerminalState = {
      state: toPersisted(state),
      lastSeenAt: lastSeenAt.get(terminalId) ?? new Date().toISOString(),
    };
    storage.set(stateStorageKey(terminalId), stored);
  }

  function dispatch(terminalId: string, ev: AgentEvent) {
    const prev = states.get(terminalId);
    if (!prev) return;
    const next = reduce(prev, ev);

    // Any live, non-timer signal reconfirms this terminal's aliveness, even
    // when the transition itself is a no-op — bump + persist the heartbeat
    // so a long unchanging "working" phase doesn't look stale on restart.
    if (isLiveSignal(ev)) {
      lastSeenAt.set(terminalId, ev.now);
      confirmed.add(terminalId);
    }

    // reduce() returns prev by identity when nothing changed — critical here,
    // since Claude Code's braille spinner emits an OSC 0 per animation frame
    // and each invalidation re-renders the Workspaces panel and terminal tabs.
    if (next === prev) {
      if (isLiveSignal(ev)) persistState(terminalId, prev);
      return;
    }
    const tid = terminalId.slice(-8);
    if (ev.type === "detected") {
      log(
        `${tid} ${prev.activity}→${next.activity}` +
          ` isAgent=${next.isAgent} needsAttn=${next.needsAttention}` +
          ` (src=${ev.source} status=${ev.status})`,
      );
    } else {
      log(`${tid} activated → needsAttn cleared`);
    }
    states.set(terminalId, next);
    // Fires regardless of focus — including when you're watching the
    // terminal, where reduce() lands straight on "done" instead of
    // "waiting" (see agent-status.ts) since the finish is auto-acknowledged.
    if (
      !suppressTransitionSound &&
      prev.activity === "working" &&
      next.isAgent &&
      (next.activity === "waiting" || next.activity === "done")
    ) {
      maybePlayTransitionSound();
    }
    persistState(terminalId, next);
    ctx.workspaces.invalidateStatus();
    ctx.terminals.invalidateTabDecorations();
  }

  function detectedEvent(
    terminalId: string,
    status: Activity,
    source: EventSource,
  ): AgentEvent {
    return {
      type: "detected",
      status,
      source,
      // With focusBehavior "none", focus must never affect status — including
      // the watched-finish shortcut to "done" — so report not-active. For
      // "clear"/"hide" this is a plain focus check; the extra row hiding that
      // distinguishes "hide" lives in index.tsx's provider, not here.
      isActiveTerminal:
        settingsService.getState().focusBehavior !== "none" &&
        terminalId === activeTerminalId,
      now: new Date().toISOString(),
    };
  }

  function clearShellIdleTimer(terminalId: string) {
    const t = shellIdleTimers.get(terminalId);
    if (t !== undefined) {
      clearTimeout(t);
      shellIdleTimers.delete(terminalId);
    }
  }

  function scheduleShellIdle(terminalId: string) {
    clearShellIdleTimer(terminalId);
    shellIdleTimers.set(
      terminalId,
      setTimeout(() => {
        shellIdleTimers.delete(terminalId);
        dispatch(terminalId, detectedEvent(terminalId, "waiting", "timer"));
      }, SHELL_IDLE_MS),
    );
  }

  function clearAgentIdleTimer(terminalId: string) {
    const t = agentIdleTimers.get(terminalId);
    if (t !== undefined) {
      clearTimeout(t);
      agentIdleTimers.delete(terminalId);
    }
  }

  function scheduleAgentIdle(terminalId: string) {
    clearAgentIdleTimer(terminalId);
    agentIdleTimers.set(
      terminalId,
      setTimeout(() => {
        agentIdleTimers.delete(terminalId);
        dispatch(terminalId, detectedEvent(terminalId, "waiting", "agent"));
      }, AGENT_IDLE_DEBOUNCE_MS),
    );
  }

  function applyDetection(
    terminalId: string,
    result: {
      status: Activity;
      source: EventSource;
      timer?: "schedule" | "schedule-agent" | "clear";
    },
  ) {
    log(
      `detect → ${result.status}/${result.source}` +
        (result.timer ? ` timer:${result.timer}` : "") +
        ` tid=…${terminalId.slice(-8)}`,
    );
    if (result.timer === "schedule") scheduleShellIdle(terminalId);
    else if (result.timer === "clear") clearShellIdleTimer(terminalId);

    if (result.status === "waiting" && result.source === "agent") {
      // Debounce: Claude emits ✳ briefly between tool calls. Only transition
      // to "waiting" if no braille-spinner (working) OSC arrives within
      // AGENT_IDLE_DEBOUNCE_MS. The working branch below clears this timer —
      // except schedule-agent (Cursor spinner fallback), which keeps resetting
      // it so silence after the last frame ends the working phase.
      scheduleAgentIdle(terminalId);
    } else if (result.timer === "schedule-agent") {
      // Cursor Agent raw-output spinner: keep the agent-idle timer armed so
      // AGENT_IDLE_DEBOUNCE_MS of silence after the last frame → waiting.
      // Must NOT clearAgentIdleTimer here (that would defeat the fallback).
      scheduleAgentIdle(terminalId);
      dispatch(
        terminalId,
        detectedEvent(terminalId, result.status, result.source),
      );
    } else {
      if (result.status === "working") clearAgentIdleTimer(terminalId);
      dispatch(
        terminalId,
        detectedEvent(terminalId, result.status, result.source),
      );
    }
  }

  /**
   * Correct restored state from the host's current terminal title (OSC 0
   * payload). Applied once when a terminal is first tracked / when storage
   * finally hydrates — not on every workspace tick, so a brief ✳ flicker
   * between Claude tool calls can't keep resetting us. Unlike live OSC
   * frames, a title at restore time is already settled, so ✳ → waiting is
   * applied immediately (no agent-idle debounce).
   */
  function seedFromTitle(terminalId: string, title: string) {
    const cur = states.get(terminalId);
    if (!cur) return;
    const wasAgentWorking =
      cur.activity === "working" && cur.workingSource === "agent";
    const result = detectFromOscTitle(title, wasAgentWorking);
    if (!result) return;
    log(
      `title-seed "${title.slice(0, 40)}" → ${result.status}/${result.source}` +
        ` tid=…${terminalId.slice(-8)}`,
    );
    if (result.timer === "schedule") scheduleShellIdle(terminalId);
    else if (result.timer === "clear") clearShellIdleTimer(terminalId);
    clearAgentIdleTimer(terminalId);
    // Title seed counts as confirmation so a late storage hydrate can't
    // stomp a corrected waiting state with an older persisted "working".
    confirmed.add(terminalId);
    suppressTransitionSound = true;
    try {
      dispatch(
        terminalId,
        detectedEvent(terminalId, result.status, result.source),
      );
    } finally {
      suppressTransitionSound = false;
    }
  }

  function subscribeTerminalOsc(terminalId: string, sessionId: string) {
    const prevSessionId = oscSubSessionIds.get(terminalId);
    // Skip if we already have a live sub for this exact session. If sessionId
    // is still empty (PTY not spawned yet), the prior poll is still running;
    // only skip if a real session is already subscribed.
    if (
      oscSubs.has(terminalId) &&
      prevSessionId === sessionId &&
      sessionId !== ""
    )
      return;
    // Dispose any stale sub (e.g. subscribed before the PTY spawned, poll
    // timed out, and now the PTY has spawned with a new sessionId).
    const stale = oscSubs.get(terminalId);
    if (stale) {
      stale.dispose();
      oscSubs.delete(terminalId);
    }
    const staleOut = outputSubs.get(terminalId);
    if (staleOut) {
      staleOut.dispose();
      outputSubs.delete(terminalId);
    }
    oscSubSessionIds.set(terminalId, sessionId);
    const sub = ctx.terminals.subscribeOsc(terminalId, ({ code, payload }) => {
      for (const detect of AGENT_DETECTORS) {
        const result = detect(code, payload);
        if (result) {
          log(
            `osc${code} "${payload.slice(0, 40)}" → ${result.status}/${result.source}` +
              (result.timer ? ` timer:${result.timer}` : "") +
              ` tid=…${terminalId.slice(-8)}`,
          );
          applyDetection(terminalId, result);
          return;
        }
      }
      // Codex: braille spinner → working (shared with Claude), then a plain
      // project title when idle. No dedicated idle OSC, and the shell idle
      // timer must not demote agent-sourced working (Claude background tabs).
      const cur = states.get(terminalId);
      const idle = detectCodexIdleAfterWorking(
        code,
        payload,
        cur?.activity === "working" && cur.workingSource === "agent",
      );
      if (idle) {
        log(
          `osc${code} "${payload.slice(0, 40)}" → ${idle.status}/${idle.source}` +
            ` (codex plain-title idle) tid=…${terminalId.slice(-8)}`,
        );
        applyDetection(terminalId, idle);
      }
    });
    oscSubs.set(terminalId, sub);

    // Cursor Agent fallback: its OSC status titles are off by default
    // (showStatusIndicators: false). The ink spinner still lands in the raw
    // PTY stream, so watch output for those frames.
    const outSub = ctx.terminals.subscribeOutput(terminalId, (chunk) => {
      const result = detectCursorAgentOutput(chunk);
      if (result) applyDetection(terminalId, result);
    });
    outputSubs.set(terminalId, outSub);
    // Note: do NOT push into ctx.subscriptions — oscSubs/outputSubs manage the
    // lifecycle of these per-terminal subscriptions (disposed in teardownTerminal
    // and the bulk dispose() below). Pushing them would cause the array to grow
    // unboundedly as terminals open and close, and stale entries would be
    // double-disposed at deactivation.
  }

  // Releases every per-terminal resource for `terminalId`: the OSC
  // subscription, both idle timers, and its in-memory state/heartbeat.
  // `clearStorage` distinguishes the two callers: a terminal that's actually
  // gone (closed) should have its persisted blob wiped, while the extension
  // merely deactivating should leave persisted state alone so it can restore
  // on the next activation.
  function teardownTerminal(terminalId: string, opts: { clearStorage: boolean }) {
    oscSubs.get(terminalId)?.dispose();
    oscSubs.delete(terminalId);
    outputSubs.get(terminalId)?.dispose();
    outputSubs.delete(terminalId);
    oscSubSessionIds.delete(terminalId);
    states.delete(terminalId);
    lastSeenAt.delete(terminalId);
    confirmed.delete(terminalId);
    clearShellIdleTimer(terminalId);
    clearAgentIdleTimer(terminalId);
    if (opts.clearStorage) storage.set(stateStorageKey(terminalId), undefined);
  }

  function adoptTerminal(t: {
    id: string;
    kind: TerminalAgentState["kind"];
    title: string;
    sessionId: string;
  }) {
    const stored = storage.get<StoredTerminalState>(stateStorageKey(t.id));
    const gapMs = stored
      ? Date.now() - new Date(stored.lastSeenAt).getTime()
      : 0;
    states.set(t.id, restoreState(t.kind, stored?.state, gapMs));
    if (stored) lastSeenAt.set(t.id, stored.lastSeenAt);
    // Host title is often fresher than persisted state after a reload —
    // agent may have finished (✳ / plain Codex title) while we were down.
    seedFromTitle(t.id, t.title);
    subscribeTerminalOsc(t.id, t.sessionId);
  }

  function syncOscSubscriptions() {
    const ws = ctx.workspaces.getState();
    const live = new Set<string>();
    for (const workspace of ws.all) {
      for (const t of workspace.terminals) {
        live.add(t.id);
        if (!states.has(t.id)) adoptTerminal(t);
        else subscribeTerminalOsc(t.id, t.sessionId);
      }
    }
    // Clean up state for terminals that no longer exist.
    for (const id of [...oscSubs.keys()]) {
      if (!live.has(id)) teardownTerminal(id, { clearStorage: true });
    }
  }

  /**
   * `ctx.storage` hydrates asynchronously — the first sync at activate may
   * see an empty bag and fall back to initialState. When persisted blobs
   * arrive, re-adopt any terminal that hasn't been confirmed by a live
   * signal or title seed yet (same pattern as settings-store.ts).
   */
  function rehydrateFromStorage() {
    const ws = ctx.workspaces.getState();
    let changed = false;
    for (const workspace of ws.all) {
      for (const t of workspace.terminals) {
        if (confirmed.has(t.id)) continue;
        const stored = storage.get<StoredTerminalState>(stateStorageKey(t.id));
        if (!stored) continue;
        const gapMs = Date.now() - new Date(stored.lastSeenAt).getTime();
        states.set(t.id, restoreState(t.kind, stored.state, gapMs));
        lastSeenAt.set(t.id, stored.lastSeenAt);
        seedFromTitle(t.id, t.title);
        changed = true;
      }
    }
    if (changed) {
      ctx.workspaces.invalidateStatus();
      ctx.terminals.invalidateTabDecorations();
    }
  }

  const disposables = [
    ctx.workspaces.subscribe(() => {
      // Terminal titles/names live on workspace state, so status-row labels
      // may have changed even when our own state hasn't.
      ctx.workspaces.invalidateStatus();
      syncOscSubscriptions();
    }),
    ctx.terminals.subscribeActive((terminalId) => {
      activeTerminalId = terminalId;
      // Viewing a terminal acknowledges a pending finished status (green →
      // grey "done") — unless the user chose focusBehavior "none", where
      // focus never touches status.
      if (terminalId && settingsService.getState().focusBehavior !== "none") {
        dispatch(terminalId, { type: "activated" });
      }
      // Re-render rows on every focus change so the provider's focus
      // suppression (focusBehavior "hide") tracks the active terminal even
      // when the dispatch above was a no-op.
      ctx.workspaces.invalidateStatus();
    }),
    storage.subscribe(rehydrateFromStorage),
  ];

  // Subscribe to any terminals already open at activation time.
  syncOscSubscriptions();

  return {
    states,
    get activeTerminalId() {
      return activeTerminalId;
    },
    dispose() {
      for (const d of disposables) d.dispose();
      // Bulk cleanup at deactivation for whatever per-terminal resources are
      // still live at that point. clearStorage: false — persisted state
      // should survive so a working/needs-attention row's elapsed time
      // restores correctly on the next activation.
      for (const id of [...oscSubs.keys()]) {
        teardownTerminal(id, { clearStorage: false });
      }
    },
  };
}
