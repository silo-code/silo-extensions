/**
 * The Navigator's cross-workspace **Follow-ups** view — every flagged tab in
 * every workspace, in one place.
 *
 * Grouping is a `"navigator"`-surface toolbar item in the host's view header,
 * not a second registered view: the SDK says a grouping a view supports is a
 * control *inside* that view, since two entries in the view list leave the
 * user with no rule for which to trust.
 *
 * The projection itself is pure (`lib/view.ts`); this file is the body that
 * renders it, plus the row-click reveal and the per-row `⋯` menu.
 */

import { Badge, EmptyState, useServiceState } from "@silo-code/sdk";
import type { ExtensionContext } from "@silo-code/sdk";
import { isCurrent, type ActiveTabRef } from "../lib/active-tab";
import { CaretRight, Flag } from "@phosphor-icons/react";
import type { MarksStore } from "../lib/marks-store";
import type { SettingsStore } from "../lib/settings-store";
import {
  buildFollowUpView,
  collectItems,
  itemKey,
  type FollowUpItem,
} from "../lib/view";
import type { ViewPrefsStore } from "../lib/view-prefs";
import { FollowUpRow } from "./FollowUpRow";

export function FollowUpsView({
  ctx,
  marks,
  settings,
  prefs,
  onRowMenu,
}: {
  ctx: ExtensionContext;
  marks: MarksStore;
  settings: SettingsStore;
  prefs: ViewPrefsStore;
  /** Opens the shared follow-up menu where a row was right-clicked. */
  onRowMenu: (item: FollowUpItem, at: { x: number; y: number }) => void;
}) {
  const ws = useServiceState(ctx.workspaces);
  const editors = useServiceState(ctx.editors);
  const terminalId = useServiceState(ctx.terminals);
  // `null` whenever the active tab is an editor or a terminal.
  const activePanel = useServiceState(ctx.panels);
  const marksSnapshot = useServiceState(marks);
  const { labels } = useServiceState(settings);
  const view = useServiceState(prefs);

  const active: ActiveTabRef = {
    workspaceId: ws.activeId,
    editorId: editors.active?.editorId ?? null,
    terminalId,
    panelRecordId: activePanel?.recordId ?? null,
  };

  const items = collectItems(ws.all, marksSnapshot.state);
  const groups = buildFollowUpView(
    items,
    labels,
    view.groupBy,
    view.collapsedGroups,
  );

  if (items.length === 0) {
    return (
      <div className="fu-view">
        <EmptyState
          icon={<Flag size={22} weight="duotone" />}
          title="No follow-ups"
          description="Flag a tab with the Follow-up button on its toolbar, or from its right-click menu, and it shows up here."
        />
      </div>
    );
  }

  return (
    <div className="fu-view">
      <div className="fu-list">
        {groups.map((group) => {
          // The single unnamed group has no header, so it can't collapse.
          const collapsible = group.title !== "";
          const open = !collapsible || !group.collapsed;
          return (
            <div className="fu-group" key={group.key}>
              {collapsible && (
                <div
                  className="fu-section-head"
                  role="button"
                  tabIndex={0}
                  aria-expanded={open}
                  onClick={() => prefs.toggleGroup(group.key)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      prefs.toggleGroup(group.key);
                    }
                  }}
                >
                  {/* One caret that rotates, not a `CaretDown`/`CaretRight`
                      swap — the canonical Navigator heading animates the
                      turn, and swapping two glyphs can't. */}
                  <CaretRight
                    size="0.7em"
                    weight="bold"
                    className={
                      open ? "fu-section-chev fu-open" : "fu-section-chev"
                    }
                    aria-hidden="true"
                  />
                  <span className="fu-section-title">{group.title}</span>
                  <Badge size="sm" className="fu-section-count">
                    {group.items.length}
                  </Badge>
                </div>
              )}
              {open &&
                group.items.map((item) => (
                  <FollowUpRow
                    key={itemKey(item)}
                    item={item}
                    labels={labels}
                    showWorkspace={view.groupBy !== "workspace"}
                    showLabel={view.groupBy !== "label"}
                    current={isCurrent(item, active)}
                    onOpen={() => reveal(ctx, item)}
                    onMenu={(at) => onRowMenu(item, at)}
                  />
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Get the user to a flagged tab — every row lands on its own tab, whatever
 * kind it is.
 *
 * Each `focus` verb activates the owning workspace itself, so there is no
 * `workspaces.activate` call here to race against them. `editors.focus` takes
 * a record id rather than a path, which is what reaches an untitled buffer or
 * a diff — neither of which `open(path)` can name.
 */
function reveal(ctx: ExtensionContext, item: FollowUpItem): void {
  if (item.kind === "terminal") {
    ctx.terminals.focus(item.targetId);
  } else if (item.kind === "panel") {
    ctx.panels.focus(item.targetId);
  } else {
    ctx.editors.focus(item.targetId, { workspaceId: item.workspaceId });
  }
}
