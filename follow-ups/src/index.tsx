/**
 * `silo.follow-ups` — mark a tab to come back to, with a reason.
 *
 * A follow-up is a **color + name** pair ("Blocked", "Needs review") plus an
 * optional note. The tab itself shows only the color — a whole-tab tint in one
 * of the five host semantic colors; the name and note live in the tab's
 * follow-up dropdown and in the cross-workspace Navigator view.
 *
 * This file is wiring only: registrations, binders, panel sections, and the two
 * handles that get re-registered when settings change. Everything with logic
 * in it lives in `lib/` (pure, `import type` only) or `ui/` (React).
 */

import type {
  Disposable,
  Extension,
  ExtensionContext,
  MenuContext,
  MenuEntry,
  ToolbarItemContext,
} from "@silo-code/sdk";
import { Flag } from "@phosphor-icons/react";
import {
  defaultLabel,
  labelById,
  labelColor,
  type LabelId,
} from "./lib/labels";
import {
  clearFollowUp,
  getFollowUp,
  parseMarks,
  pruneWorkspace,
  serializeMarks,
  setFollowUp,
  setNote,
  toggleFollowUp,
  type MarkChange,
  type MarksState,
} from "./lib/store";
import { createMarksStore } from "./lib/marks-store";
import { defaultLabelId, initSettings } from "./lib/settings-store";
import { createViewPrefsStore } from "./lib/view-prefs";
import {
  buildWorkspaceIndex,
  type WorkspaceIndex,
} from "./lib/workspace-index";
import {
  resolveTarget,
  targetFromPanelContext,
  type PanelTarget,
  type TargetLookups,
} from "./lib/target";
import { followUpMenu, groupMenu, type FollowUpActions } from "./lib/menus";
import { buildToolbarItems } from "./lib/toolbar";
import { GROUP_BY_LABELS, type FollowUpItem } from "./lib/view";
import { FollowUpsView } from "./ui/FollowUpsView";
import { WorkspaceSummaryRow } from "./ui/WorkspaceSummaryRow";
import { LabelDot } from "./ui/glyphs";
import { NoteModal } from "./ui/NoteModal";
import { FollowUpsSettingsPage } from "./ui/settings";
import styles from "./ui/follow-ups.css";

const STORAGE_KEY = "marks";
const STYLE_ID = "silo-follow-ups-styles";
const VIEW_ID = "silo.follow-ups.view";
const ADORNMENT_ID = "silo.follow-ups.tab-highlight";

function activate(ctx: ExtensionContext) {
  injectStyles();

  const settings = initSettings(ctx.storage.global);
  const prefs = createViewPrefsStore(ctx.storage.global);
  ctx.subscriptions.push(
    { dispose: () => settings.dispose() },
    { dispose: () => prefs.dispose() },
  );

  const marks = createMarksStore(
    parseMarks(ctx.storage.global.get(STORAGE_KEY), currentDefaultId()),
  );
  let index: WorkspaceIndex = buildWorkspaceIndex(ctx.workspaces.getState().all);

  // Declared up here, not beside the registrations below, because the settings
  // and prefs subscribers drive them and must never see them in their TDZ.
  let toolbarItems: Disposable[] = [];
  let toolbarTooltip: string | null = null;
  let groupByItem: Disposable | undefined;
  let groupByTitle: string | null = null;

  function currentDefaultId(): LabelId {
    return defaultLabelId(settings.getState());
  }

  function persist() {
    ctx.storage.global.set(STORAGE_KEY, serializeMarks(marks.marks()));
  }

  // Tabs only. The Workspaces-panel line is a section — a live component that
  // re-renders off the marks store itself — so there is nothing to invalidate
  // there, and the SDK ships no `invalidateSection` by design.
  function invalidateChrome() {
    ctx.invalidateToolbarItems();
    ctx.editors.invalidateTabAdornments();
    ctx.terminals.invalidateTabAdornments();
    ctx.panels.invalidateTabAdornments();
  }

  /**
   * Run a mutation, then persist + repaint iff it actually changed something.
   * `MarkChange` rather than a boolean is what makes a re-label or a note edit
   * reach the chrome — the 0.2.x `mark()` returned "no change" for an
   * already-marked tab, which would now swallow both.
   */
  function apply(mutate: (state: MarksState) => MarkChange) {
    const change = mutate(marks.marks());
    if (change === "none") return;
    persist();
    marks.notify();
    invalidateChrome();
  }

  // ─── Targets ──────────────────────────────────────────────────────────────

  /**
   * The index lookups the target resolvers need, as one stable object:
   * `index` is **reassigned** on every workspace-state change, so these
   * delegate rather than capture its methods.
   */
  const lookups: TargetLookups = {
    workspaceFor: (kind, id) => index.findWorkspaceFor(kind, id),
    panelFor: (panelId) => index.panelLocation(panelId),
  };

  function editorTarget(
    t: ToolbarItemContext["editor"] | MenuContext["editor/tab"],
  ): PanelTarget | null {
    const workspaceId = index.findWorkspaceFor("editor", t.editorId);
    return workspaceId
      ? { kind: "editor", id: t.editorId, workspaceId }
      : null;
  }

  function terminalTarget(t: MenuContext["terminal/tab"]): PanelTarget | null {
    const workspaceId =
      t.workspaceId || index.findWorkspaceFor("terminal", t.terminalId);
    return workspaceId
      ? { kind: "terminal", id: t.terminalId, workspaceId }
      : null;
  }

  function panelTarget(
    t: ToolbarItemContext["panel"] | MenuContext["panel/tab"],
  ): PanelTarget | null {
    return targetFromPanelContext(t, lookups);
  }

  function lookup(target: PanelTarget | null) {
    if (!target) return null;
    return getFollowUp(marks.marks(), target.workspaceId, target.kind, target.id);
  }

  function marked(target: PanelTarget | null): boolean {
    return lookup(target) !== null;
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  function actionsFor(target: PanelTarget): FollowUpActions {
    const { workspaceId, kind, id } = target;
    return {
      setLabel: (labelId) =>
        apply((s) =>
          setFollowUp(s, workspaceId, kind, id, { labelId }, Date.now()),
        ),
      editNote: () => void openNoteModal(target),
      removeNote: () => apply((s) => setNote(s, workspaceId, kind, id, "")),
      clear: () => apply((s) => clearFollowUp(s, workspaceId, kind, id)),
    };
  }

  async function openNoteModal(target: PanelTarget) {
    const current = lookup(target);
    if (!current) return;
    const label = labelById(settings.getState().labels, current.labelId);
    // `dismissible` defaults to **false** on `showModal`, so it's passed
    // explicitly — an un-dismissible note editor would trap the user.
    const next = await ctx.ui.showModal<string>(
      (close) => (
        <NoteModal
          initial={current.note}
          labelName={label.name}
          onSave={(note) => close(note)}
          onCancel={() => close()}
        />
      ),
      { title: "Follow-up note", size: "sm", dismissible: true },
    );
    // `undefined` is cancel / dismiss; `""` is a deliberately emptied note.
    if (next === undefined) return;
    apply((s) =>
      setNote(s, target.workspaceId, target.kind, target.id, next.trim()),
    );
  }

  function menuFor(target: PanelTarget | null): MenuEntry[] {
    if (!target) return [];
    return followUpMenu(
      settings.getState().labels,
      lookup(target),
      actionsFor(target),
      (labelId) => <LabelDot labelId={labelId} />,
    );
  }

  function runAction(action: "toggle" | "mark" | "clear" | "note") {
    return (...args: unknown[]) => {
      // Toolbar / context-menu invocations name their tab in args[0]; a
      // keybinding passes nothing and falls back to the active tab.
      const target = resolveTarget(
        args,
        {
          editorId: ctx.editors.getState().active?.editorId ?? null,
          terminalId: ctx.terminals.getState(),
          panel: activePanelTarget(ctx),
        },
        lookups,
      );
      if (!target) return;
      const { workspaceId, kind, id } = target;
      if (action === "note") {
        void openNoteModal(target);
      } else if (action === "toggle") {
        apply((s) =>
          toggleFollowUp(
            s,
            workspaceId,
            kind,
            id,
            currentDefaultId(),
            Date.now(),
          ),
        );
      } else if (action === "mark") {
        apply((s) =>
          setFollowUp(
            s,
            workspaceId,
            kind,
            id,
            { labelId: currentDefaultId() },
            Date.now(),
          ),
        );
      } else {
        apply((s) => clearFollowUp(s, workspaceId, kind, id));
      }
    };
  }

  // ─── Pruning ──────────────────────────────────────────────────────────────

  /**
   * Drop marks whose tab or workspace is gone. Guarded on `hydrated`: before
   * the persisted workspace state loads, `all` is empty, and pruning against
   * it would delete every mark the user has.
   */
  function pruneAll(): boolean {
    if (!ctx.workspaces.getState().hydrated) return false;
    const state = marks.marks();
    const liveWorkspaces = index.workspaceIds();
    let changed = false;
    for (const workspaceId of liveWorkspaces) {
      const live = index.liveIds(workspaceId);
      if (
        pruneWorkspace(
          state,
          workspaceId,
          live.editors,
          live.terminals,
          live.panels,
        )
      ) {
        changed = true;
      }
    }
    for (const id of [...state.keys()]) {
      if (!liveWorkspaces.has(id)) {
        state.delete(id);
        changed = true;
      }
    }
    return changed;
  }

  // ─── Subscriptions ────────────────────────────────────────────────────────

  ctx.subscriptions.push(
    ctx.storage.global.subscribe(() => {
      // `ExtensionStorage.subscribe` also fires once hydration finishes, which
      // is a second chance to unblock the view's first pref write — belt and
      // braces beside the workspace `hydrated` flag below, since a bag that
      // has never been written is the case most likely to be missed.
      prefs.setHydrated(true);
      marks.replace(
        parseMarks(ctx.storage.global.get(STORAGE_KEY), currentDefaultId()),
      );
      invalidateChrome();
    }),
  );

  // `NavigatorViewProps` carries no `hydrated` flag, so the view can render —
  // and the user can flip its group-by — before persisted state has loaded. The
  // workspace store's flag is the same app-state hydration the storage bag
  // waits on, so it's the signal `tasks` uses for its aggregated surfaces too.
  prefs.setHydrated(ctx.workspaces.getState().hydrated);

  ctx.subscriptions.push(
    ctx.workspaces.subscribe(() => {
      prefs.setHydrated(ctx.workspaces.getState().hydrated);
      index = buildWorkspaceIndex(ctx.workspaces.getState().all);
      // No `else`: a tab list that changed without pruning anything still
      // changes the Workspaces-panel counts, but that line subscribes to the
      // workspace state itself and re-renders on the same notification.
      if (pruneAll()) {
        persist();
        marks.notify();
        invalidateChrome();
      }
    }),
  );

  ctx.subscriptions.push(
    settings.subscribe(() => {
      // A rename changes the Flag's tooltip; a reorder or a new default
      // changes the dropdown and the per-label status rows; either can change
      // which color a tab is tinted.
      syncToolbarItems();
      invalidateChrome();
    }),
  );

  // Initial prune of stale ids from a prior session.
  if (pruneAll()) persist();

  // ─── Commands ─────────────────────────────────────────────────────────────

  ctx.subscriptions.push(
    ctx.registerCommand({
      id: "silo.follow-ups.toggle",
      label: "Follow-ups: Toggle",
      run: runAction("toggle"),
    }),
    ctx.registerCommand({
      id: "silo.follow-ups.mark",
      label: "Follow-ups: Mark as follow-up",
      run: runAction("mark"),
    }),
    ctx.registerCommand({
      id: "silo.follow-ups.clear",
      label: "Follow-ups: Clear follow-up",
      run: runAction("clear"),
    }),
    ctx.registerCommand({
      id: "silo.follow-ups.note",
      label: "Follow-ups: Follow-up note…",
      run: runAction("note"),
    }),
  );

  // ─── Toolbar: the Flag control ────────────────────────────────────────────

  /**
   * Register every toolbar contribution, replacing whatever the last call
   * left behind.
   *
   * Re-registration exists because the command half's `tooltip` is a plain
   * string and so can't read the default label's name live — rename the
   * default and the tooltip has to be rebuilt. The caret rides on that same
   * item, so it is rebuilt along with it. **Every** item this function
   * registered is disposed before the next set goes in, so no disposable is
   * left dangling across a re-register.
   *
   * Deliberately **not** pushed onto `ctx.subscriptions` —
   * `ctx.registerToolbarItem` already tracks there, and re-registering under
   * the same id each time would pile up stale entries.
   */
  function syncToolbarItems() {
    const tooltip = `Mark as follow-up: ${defaultLabel(settings.getState().labels).name}`;
    if (tooltip === toolbarTooltip && toolbarItems.length > 0) return;
    toolbarTooltip = tooltip;
    for (const d of toolbarItems) d.dispose();

    const built = buildToolbarItems({
      tooltip,
      editorMarked: (t) => marked(editorTarget(t)),
      editorMenu: (t) => menuFor(editorTarget(t)),
      panelAvailable: (t) => panelTarget(t) !== null,
      panelMarked: (t) => marked(panelTarget(t)),
      panelMenu: (t) => menuFor(panelTarget(t)),
    });

    toolbarItems = [
      ...built.editor.map((item) => ctx.registerToolbarItem(item)),
      ...built.panel.map((item) => ctx.registerToolbarItem(item)),
    ];
  }

  syncToolbarItems();

  // ─── Context menus ────────────────────────────────────────────────────────

  // Command-backed Mark / Clear / Note, since `ContextMenuContribution` has no
  // `submenu` to hang the label picker off. This is the **always-available**
  // path: toolbar items only render while the surface's breadcrumbs setting is
  // on, so without these a user with breadcrumbs off would have no way in.
  // Mark applies the default label.
  ctx.subscriptions.push(
    ctx.registerContextMenuItem({
      surface: "editor/tab",
      command: "silo.follow-ups.mark",
      label: "Mark as follow-up",
      group: "follow-ups",
      when: (_k, t) => !marked(editorTarget(t)),
    }),
    ctx.registerContextMenuItem({
      surface: "editor/tab",
      command: "silo.follow-ups.note",
      label: "Follow-up note…",
      group: "follow-ups",
      when: (_k, t) => marked(editorTarget(t)),
    }),
    ctx.registerContextMenuItem({
      surface: "editor/tab",
      command: "silo.follow-ups.clear",
      label: "Clear follow-up",
      group: "follow-ups",
      when: (_k, t) => marked(editorTarget(t)),
    }),
    ctx.registerContextMenuItem({
      surface: "terminal/tab",
      command: "silo.follow-ups.mark",
      label: "Mark as follow-up",
      group: "follow-ups",
      when: (_k, t) => !marked(terminalTarget(t)),
    }),
    ctx.registerContextMenuItem({
      surface: "terminal/tab",
      command: "silo.follow-ups.note",
      label: "Follow-up note…",
      group: "follow-ups",
      when: (_k, t) => marked(terminalTarget(t)),
    }),
    ctx.registerContextMenuItem({
      surface: "terminal/tab",
      command: "silo.follow-ups.clear",
      label: "Clear follow-up",
      group: "follow-ups",
      when: (_k, t) => marked(terminalTarget(t)),
    }),
    // RFC 0046: every dock panel tab that isn't an editor or a terminal (a
    // Chat transcript, a web viewer, …) gets the same rows on the "panel/tab"
    // surface.
    ctx.registerContextMenuItem({
      surface: "panel/tab",
      command: "silo.follow-ups.mark",
      label: "Mark as follow-up",
      group: "follow-ups",
      when: (_k, t) => {
        const target = panelTarget(t);
        return target !== null && !marked(target);
      },
    }),
    ctx.registerContextMenuItem({
      surface: "panel/tab",
      command: "silo.follow-ups.note",
      label: "Follow-up note…",
      group: "follow-ups",
      when: (_k, t) => marked(panelTarget(t)),
    }),
    ctx.registerContextMenuItem({
      surface: "panel/tab",
      command: "silo.follow-ups.clear",
      label: "Clear follow-up",
      group: "follow-ups",
      when: (_k, t) => marked(panelTarget(t)),
    }),
  );

  // ─── Tab tint ─────────────────────────────────────────────────────────────

  // Whole-tab highlight, not a trailing Flag indicator: the tab shows the
  // follow-up's **color** and nothing else, and the color is one of the five
  // theme-overridable semantic tokens, so the tint tracks the user's preset.
  //
  // `provide` is called synchronously per tab during render, so every lookup
  // here goes through the prebuilt `workspace-index` — the 0.2.x code ran a
  // full workspace scan inside this callback.
  ctx.subscriptions.push(
    ctx.editors.bindHighlight({
      id: ADORNMENT_ID,
      provide: (editorId) => tint(editorTarget({ editorId })),
    }),
    ctx.terminals.bindHighlight({
      id: ADORNMENT_ID,
      provide: (terminalId) => {
        const workspaceId = index.findWorkspaceFor("terminal", terminalId);
        return workspaceId
          ? tint({ kind: "terminal", id: terminalId, workspaceId })
          : null;
      },
    }),
    ctx.panels.bindHighlight({
      id: ADORNMENT_ID,
      // The binder's target id is the live `panelId`; the mark is filed under
      // the record's stable `id`. The index is the bridge.
      provide: (panelId) => {
        const located = index.panelLocation(panelId);
        return located
          ? tint({
              kind: "panel",
              id: located.recordId,
              workspaceId: located.workspaceId,
            })
          : null;
      },
    }),
  );

  function tint(target: PanelTarget | null) {
    const fu = lookup(target);
    if (!fu) return null;
    return { color: labelColor(settings.getState().labels, fu.labelId) };
  }

  // ─── Workspaces panel ─────────────────────────────────────────────────────

  // Exactly one line, however many labels are in use — but a *section*, not a
  // `WorkspaceStatusRow`: a status row carries one host-owned `Activity`
  // glyph, so the rollup could only ever be a single amber dot that said
  // nothing about which labels were waiting. A section is a real component,
  // so the line opens with one dot per label in use at no extra height. A
  // row per label is still out — four lines from one extension would bury the
  // workspace's own chrome, and the itemized breakdown has the Navigator view.
  //
  // Sections have no `invalidate` hook by design; the component re-renders off
  // the stores it reads, which is why `index` goes in as a getter — it is
  // reassigned wholesale on every workspace-state change.
  ctx.subscriptions.push(
    ctx.workspaces.registerSection({
      id: "silo.follow-ups.section",
      component: ({ workspaceId }) => (
        <WorkspaceSummaryRow
          workspaceId={workspaceId}
          ctx={ctx}
          marks={marks}
          settings={settings}
          index={() => index}
        />
      ),
    }),
  );

  // ─── Settings page ────────────────────────────────────────────────────────

  // No `group`: a page contributed by a non-core extension is always filed
  // under "Extensions", so the field would be ignored. `SettingsPage.component`
  // takes no props, so the store arrives through this closure.
  ctx.subscriptions.push(
    ctx.registerSettingsPage({
      id: "silo.follow-ups.settings",
      title: "Follow-ups",
      component: () => <FollowUpsSettingsPage settings={settings} />,
    }),
  );

  // ─── Navigator view ───────────────────────────────────────────────────────

  // The view plus its group-by control. Grouping is a control *inside* the
  // view (a `"navigator"` toolbar item scoped with `when`), not a second
  // registered view — the SDK is explicit that one projection is one view.
  //
  // Registered unconditionally: the host's own Navigator settings already let
  // a user hide any view, so an extension-side toggle would be a second,
  // competing switch for the same thing.
  ctx.subscriptions.push(
    ctx.registerNavigatorView({
      id: VIEW_ID,
      title: "Follow-ups",
      icon: <Flag size={19} weight="duotone" />,
      order: 30,
      component: () => (
        <FollowUpsView
          ctx={ctx}
          marks={marks}
          settings={settings}
          prefs={prefs}
          onRowMenu={openRowMenu}
        />
      ),
    }),
  );

  /**
   * The group-by control: the **current mode's own name** plus the host's
   * caret, not an icon — so the closed state already answers "grouped by
   * what?" without being opened, matching the Agents view's control.
   *
   * `title` is a plain string in the SDK (unlike `when` / `checked`, which are
   * functions), so it can't read the mode live — the item is re-registered
   * under the same id whenever the mode changes. Deliberately **not** pushed
   * onto `ctx.subscriptions`: `registerToolbarItem` already tracks there, and
   * re-registering would otherwise pile up stale entries.
   */
  function syncGroupByItem() {
    const { groupBy } = prefs.getState();
    const title = GROUP_BY_LABELS[groupBy];
    if (title === groupByTitle && groupByItem) return;
    groupByTitle = title;
    groupByItem?.dispose();
    groupByItem = ctx.registerToolbarItem({
      id: "silo.follow-ups.nav.group",
      surface: "navigator",
      title,
      label: "Group follow-ups",
      tooltip: "Group follow-ups by workspace or label",
      order: 10,
      when: (_k, t) => t.viewId === VIEW_ID,
      menu: () =>
        groupMenu(prefs.getState().groupBy, (next) => prefs.setGroupBy(next)),
    });
  }

  syncGroupByItem();
  ctx.subscriptions.push(prefs.subscribe(syncGroupByItem));

  /**
   * A Navigator row's right-click menu — relabel, note, clear. The same
   * `menuFor` the toolbar caret and the tab context menus are built from, so
   * the verbs can't drift apart between surfaces, opened at the pointer.
   */
  function openRowMenu(item: FollowUpItem, at: { x: number; y: number }) {
    void ctx.ui.showMenu({
      items: menuFor({
        kind: item.kind,
        id: item.id,
        workspaceId: item.workspaceId,
      }),
      at,
    });
  }

}

/**
 * The active dock panel as a keybinding target. `null` when an editor or
 * terminal is active, and for a transient kind — which has no
 * `DockPanelRecord.id` and so cannot carry a mark in the first place.
 */
function activePanelTarget(
  ctx: ExtensionContext,
): { recordId: string; workspaceId: string } | null {
  const active = ctx.panels.getState();
  if (!active?.recordId) return null;
  return { recordId: active.recordId, workspaceId: active.workspaceId };
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = styles;
  document.head.appendChild(style);
}

function deactivate() {
  document.getElementById(STYLE_ID)?.remove();
}

export const extension: Extension = {
  id: "silo.follow-ups",
  activate,
  deactivate,
};
