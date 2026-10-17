import { describe, expect, it } from "vitest";
import {
  resolveTarget,
  type ActiveTab,
  type TargetLookups,
} from "./target";

// Every id in these tests belongs to "ws1", except the explicitly unknown ones.
const lookups: TargetLookups = {
  workspaceFor: (_kind, id) => (id.startsWith("orphan") ? undefined : "ws1"),
  // One recorded panel: the live `panelId` the host hands us maps to the
  // record id the mark is filed under. "transient" has no record.
  panelFor: (panelId) =>
    panelId === "silo.docs-panel:rec-7"
      ? { workspaceId: "ws-other", recordId: "rec-7" }
      : null,
};

const NO_ACTIVE: ActiveTab = { editorId: null, terminalId: null, panel: null };

describe("resolveTarget — from the invoking surface", () => {
  it("takes the editor a toolbar button / tab menu names", () => {
    expect(resolveTarget([{ editorId: "e1" }], NO_ACTIVE, lookups)).toEqual({
      kind: "editor",
      id: "e1",
      workspaceId: "ws1",
    });
  });

  it("takes the terminal, preferring the workspace the surface carries", () => {
    expect(
      resolveTarget(
        [{ terminalId: "t1", workspaceId: "ws-other" }],
        NO_ACTIVE,
        lookups,
      ),
    ).toEqual({ kind: "terminal", id: "t1", workspaceId: "ws-other" });
  });

  it("looks the workspace up when the surface omits it", () => {
    expect(resolveTarget([{ terminalId: "t1" }], NO_ACTIVE, lookups)).toEqual({
      kind: "terminal",
      id: "t1",
      workspaceId: "ws1",
    });
  });

  it("takes the terminal from the RFC 0039 panel toolbar target", () => {
    expect(
      resolveTarget(
        [
          {
            panelId: "terminal:t1",
            kindId: "terminal",
            workspaceId: "ws1",
            params: { terminalId: "t1" },
          },
        ],
        NO_ACTIVE,
        lookups,
      ),
    ).toEqual({ kind: "terminal", id: "t1", workspaceId: "ws1" });
  });

  // The host's panel chrome reports `workspaceId: ""` for a terminal tab that
  // was already open when the app started (its record-less fallback misses),
  // so the mark would be filed under a workspace that does not exist: the Flag
  // reads unmarked and clicking it does nothing visible.
  it("looks the workspace up when a panel toolbar target reports it blank", () => {
    expect(
      resolveTarget(
        [
          {
            panelId: "terminal:t1",
            kindId: "terminal",
            workspaceId: "",
            params: { terminalId: "t1" },
          },
        ],
        NO_ACTIVE,
        lookups,
      ),
    ).toEqual({ kind: "terminal", id: "t1", workspaceId: "ws1" });
  });

  it("is null for a blank panel workspace the index cannot place either", () => {
    expect(
      resolveTarget(
        [
          {
            panelId: "terminal:orphan-1",
            kindId: "terminal",
            workspaceId: "",
            params: { terminalId: "orphan-1" },
          },
        ],
        NO_ACTIVE,
        lookups,
      ),
    ).toBeNull();
  });

  it("is null for a terminal toolbar target missing its own terminalId", () => {
    expect(
      resolveTarget(
        [
          {
            panelId: "terminal:t1",
            kindId: "terminal",
            workspaceId: "ws1",
            params: {},
          },
        ],
        NO_ACTIVE,
        lookups,
      ),
    ).toBeNull();
  });

  it("resolves a dock panel to its DockPanelRecord.id, not its panelId", () => {
    // The persisted key has to be the record's stable id: `panelId` is
    // host-composed and restamped on every load, so a mark filed under it
    // would be pruned as dead on the next restart.
    expect(
      resolveTarget(
        [
          {
            panelId: "silo.docs-panel:rec-7",
            kindId: "silo.docs-panel",
            workspaceId: "ws-other",
            params: {},
          },
        ],
        NO_ACTIVE,
        lookups,
      ),
    ).toEqual({ kind: "panel", id: "rec-7", workspaceId: "ws-other" });
  });

  it("is null for a dock panel with no record to key a mark on", () => {
    expect(
      resolveTarget(
        [
          {
            panelId: "silo.picker:transient",
            kindId: "silo.picker",
            workspaceId: "ws1",
            params: {},
          },
        ],
        NO_ACTIVE,
        lookups,
      ),
    ).toBeNull();
  });

  it("wins over the active tab", () => {
    const active: ActiveTab = { editorId: "e-active", terminalId: null, panel: null };
    expect(resolveTarget([{ editorId: "e1" }], active, lookups)).toEqual({
      kind: "editor",
      id: "e1",
      workspaceId: "ws1",
    });
  });

  it("is null for a tab whose workspace is gone", () => {
    expect(
      resolveTarget([{ editorId: "orphan1" }], NO_ACTIVE, lookups),
    ).toBeNull();
  });
});

describe("resolveTarget — from the active tab (keybinding invocation)", () => {
  // A keybinding runs the command with NO arguments, so this fallback is the
  // only thing that gives it a tab to act on.
  it("falls back to the active editor", () => {
    const active: ActiveTab = { editorId: "e9", terminalId: null, panel: null };
    expect(resolveTarget([], active, lookups)).toEqual({
      kind: "editor",
      id: "e9",
      workspaceId: "ws1",
    });
  });

  it("falls back to the active terminal", () => {
    const active: ActiveTab = { editorId: null, terminalId: "t9", panel: null };
    expect(resolveTarget([], active, lookups)).toEqual({
      kind: "terminal",
      id: "t9",
      workspaceId: "ws1",
    });
  });

  it("is null when no tab is active", () => {
    expect(resolveTarget([], NO_ACTIVE, lookups)).toBeNull();
  });

  it("ignores a non-object first argument", () => {
    const active: ActiveTab = { editorId: "e9", terminalId: null, panel: null };
    for (const arg of [undefined, null, "e1", 42]) {
      expect(resolveTarget([arg], active, lookups)).toEqual({
        kind: "editor",
        id: "e9",
        workspaceId: "ws1",
      });
    }
  });

  it("is null when the active tab's workspace is gone", () => {
    const active: ActiveTab = { editorId: "orphan9", terminalId: null, panel: null };
    expect(resolveTarget([], active, lookups)).toBeNull();
  });
});

describe("resolveTarget — RFC 0063 recordId on the panel context", () => {
  // The host now hands the record id directly, so no index lookup is needed.
  const noIndex: TargetLookups = {
    workspaceFor: () => undefined,
    panelFor: () => null,
  };

  it("takes recordId straight off the context, without the index", () => {
    expect(
      resolveTarget(
        [
          {
            panelId: "silo.docs-panel:whatever",
            recordId: "rec-7",
            kindId: "silo.docs-panel",
            workspaceId: "ws-other",
            params: {},
          },
        ],
        NO_ACTIVE,
        noIndex,
      ),
    ).toEqual({ kind: "panel", id: "rec-7", workspaceId: "ws-other" });
  });

  it("ignores a blank or non-string recordId and falls back to the index", () => {
    for (const recordId of ["", 7, null]) {
      expect(
        resolveTarget(
          [
            {
              panelId: "silo.docs-panel:rec-7",
              recordId,
              kindId: "silo.docs-panel",
              workspaceId: "ws-other",
              params: {},
            },
          ],
          NO_ACTIVE,
          lookups,
        ),
      ).toEqual({ kind: "panel", id: "rec-7", workspaceId: "ws-other" });
    }
  });

  it("falls back to the index when the context's workspaceId is blank", () => {
    expect(
      resolveTarget(
        [
          {
            panelId: "silo.docs-panel:rec-7",
            recordId: "rec-7",
            kindId: "silo.docs-panel",
            workspaceId: "",
            params: {},
          },
        ],
        NO_ACTIVE,
        lookups,
      ),
    ).toEqual({ kind: "panel", id: "rec-7", workspaceId: "ws-other" });
  });

  it("still has nothing to key on for a transient panel on either path", () => {
    expect(
      resolveTarget(
        [
          {
            panelId: "silo.picker:transient",
            kindId: "silo.picker",
            workspaceId: "ws1",
            params: {},
          },
        ],
        NO_ACTIVE,
        noIndex,
      ),
    ).toBeNull();
  });
});

describe("resolveTarget — RFC 0064 active dock panel (keybinding invocation)", () => {
  it("falls back to the active panel, by record id", () => {
    const active: ActiveTab = {
      editorId: null,
      terminalId: null,
      panel: { recordId: "rec-7", workspaceId: "ws-other" },
    };
    expect(resolveTarget([], active, lookups)).toEqual({
      kind: "panel",
      id: "rec-7",
      workspaceId: "ws-other",
    });
  });

  it("takes the workspace from the panel state, not the index", () => {
    // The host hands both ids together, so a keybinding works even on a panel
    // whose workspace the index has never seen.
    const blind: TargetLookups = {
      workspaceFor: () => undefined,
      panelFor: () => null,
    };
    const active: ActiveTab = {
      editorId: null,
      terminalId: null,
      panel: { recordId: "rec-7", workspaceId: "ws-other" },
    };
    expect(resolveTarget([], active, blind)).toEqual({
      kind: "panel",
      id: "rec-7",
      workspaceId: "ws-other",
    });
  });

  it("is outranked by an active editor or terminal", () => {
    // At most one is ever set, but the ordering is pinned so a host that got
    // it wrong degrades predictably rather than acting on the wrong tab.
    const panel = { recordId: "rec-7", workspaceId: "ws-other" };
    expect(
      resolveTarget([], { editorId: "e9", terminalId: null, panel }, lookups),
    ).toMatchObject({ kind: "editor", id: "e9" });
    expect(
      resolveTarget([], { editorId: null, terminalId: "t9", panel }, lookups),
    ).toMatchObject({ kind: "terminal", id: "t9" });
  });
});
