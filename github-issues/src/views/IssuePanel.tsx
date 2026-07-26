import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowsClockwise,
  ArrowSquareOut,
  CaretDown,
  CaretLeft,
  DotsThreeVertical,
} from "@phosphor-icons/react";
import {
  Tooltip,
  useServiceState,
  type ExtensionContext,
  type MenuEntry,
  type SidePanelProps,
} from "@silo-code/sdk";
import { FILTER_LABELS, ISSUE_FILTERS, type IssueFilter } from "../filters";
import { buildCopyActions } from "../copy-actions";
import { findIssueInRepoStates } from "../detail-helpers";
import { useIssueStore } from "../hooks";
import { AUTH_RETRY_MINUTES, type IssueService } from "../issue-service";
import { offersClose, offersReopen } from "../status";
import type { CloseReason } from "../github-issue-api";
import { useViewStack } from "./use-view-stack";
import { IssueListView } from "./IssueListView";
import { IssueDetailView } from "./IssueDetailView";
import { detailPageSlot, listPageSlot } from "./page-slots";
import type { PanelView } from "../view-stack";

export interface IssuePanelProps extends SidePanelProps {
  ctx: ExtensionContext;
  service: IssueService;
}

function StatusButton({
  label,
  busy,
  onClick,
}: {
  label: string;
  busy: boolean;
  onClick: (anchor: HTMLElement) => void;
}) {
  return (
    <button
      type="button"
      className="ghi-status-btn"
      disabled={busy}
      onClick={(e) => onClick(e.currentTarget)}
    >
      {label}
    </button>
  );
}

export function IssuePanel({ ctx, service, storage, hydrated, active }: IssuePanelProps) {
  const { view, push, pop } = useViewStack(storage, hydrated);
  const wsState = useServiceState(ctx.workspaces);
  const workspaceId = wsState.activeId ?? "";
  const store = useIssueStore();

  const [loadingDetail, setLoadingDetail] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const filter = workspaceId ? store.getWorkspaceFilter(workspaceId) : "assigned";
  const enabled = workspaceId ? store.getWorkspaceEnabled(workspaceId) : true;
  const repoStates = workspaceId ? store.getRepoStates(workspaceId) : [];
  const workspaceReady = workspaceId ? store.isWorkspaceReady(workspaceId) : false;
  const refreshing = workspaceId ? store.isWorkspaceRefreshing(workspaceId) : false;
  const viewerLogin = store.viewerLogin;
  const authState = store.authState;
  const initialized = store.initialized;

  // The detail page keeps rendering its last-open issue while it's parked
  // off-screen mid-slide (see the render below) — tracked separately from
  // `view` so popping back to "list" doesn't blank it the instant Back is
  // pressed, before the slide-out transition finishes.
  const [lastDetailView, setLastDetailView] = useState<Extract<
    PanelView,
    { kind: "detail" }
  > | null>(view.kind === "detail" ? view : null);
  useEffect(() => {
    if (view.kind === "detail") setLastDetailView(view);
  }, [view]);

  const detailIssue = useMemo(() => {
    if (!lastDetailView) return null;
    return findIssueInRepoStates(repoStates, lastDetailView.repoKey, lastDetailView.number);
  }, [lastDetailView, repoStates]);

  const detailEntry = lastDetailView
    ? store.getDetail(lastDetailView.repoKey, lastDetailView.number)
    : undefined;
  const detailError = lastDetailView
    ? store.getDetailError(lastDetailView.repoKey, lastDetailView.number)
    : undefined;

  useEffect(() => {
    if (view.kind !== "detail" || !active) {
      setLoadingDetail(false);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    void service.fetchDetail(view.repoKey, view.number).finally(() => {
      if (!cancelled) setLoadingDetail(false);
    });
    return () => {
      cancelled = true;
      setLoadingDetail(false);
    };
  }, [view, service, active]);

  useEffect(() => {
    if (!active) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && view.kind === "detail") {
        e.stopPropagation();
        pop();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, view.kind, pop]);

  const handleRefresh = useCallback(async () => {
    if (!workspaceId) return;
    await service.refreshWorkspace(workspaceId);
  }, [service, workspaceId]);

  const handleFilter = useCallback(
    (next: IssueFilter) => {
      if (!workspaceId) return;
      store.setWorkspaceFilter(workspaceId, next);
    },
    [workspaceId, store],
  );

  const openFilterMenu = useCallback(
    (anchor: HTMLElement) => {
      const items: MenuEntry[] = ISSUE_FILTERS.map((f) => ({
        label: FILTER_LABELS[f],
        checked: f === filter,
        run: () => handleFilter(f),
      }));
      void ctx.ui.showMenu({ items, anchor });
    },
    [ctx, filter, handleFilter],
  );

  const openOverflowMenu = useCallback(
    (anchor: HTMLElement) => {
      if (!detailIssue) return;
      const items: MenuEntry[] = buildCopyActions({
        ...detailIssue,
        body: detailEntry?.detail.body,
      }).map((a) => ({
        label: a.label,
        run: () => {
          void navigator.clipboard.writeText(a.text).then(() => {
            ctx.ui.notify("info", "Copied to clipboard.");
          });
        },
      }));
      void ctx.ui.showMenu({ items, anchor });
    },
    [ctx, detailIssue, detailEntry],
  );

  const confirmAndClose = useCallback(
    async (repoKey: string, number: number, reason: CloseReason) => {
      if (!workspaceId) return;
      const confirmed = await ctx.ui.confirm({
        title: `Close #${number}?`,
        body: `Marks the issue ${reason === "completed" ? "completed" : "as not planned"}.`,
        confirmLabel: "Close",
      });
      if (!confirmed) return;

      setUpdatingStatus(true);
      try {
        const result = await service.closeIssue(workspaceId, repoKey, number, reason);
        if (result.ok) {
          ctx.ui.notify("info", `Closed #${number}.`, { title: "Issue closed" });
        } else {
          ctx.ui.notify("error", result.error.message, { title: "Couldn't close issue" });
        }
      } finally {
        setUpdatingStatus(false);
      }
    },
    [ctx, service, workspaceId],
  );

  const confirmAndReopen = useCallback(
    async (repoKey: string, number: number) => {
      if (!workspaceId) return;
      const confirmed = await ctx.ui.confirm({
        title: `Reopen #${number}?`,
        confirmLabel: "Reopen",
      });
      if (!confirmed) return;

      setUpdatingStatus(true);
      try {
        const result = await service.reopenIssue(workspaceId, repoKey, number);
        if (result.ok) {
          ctx.ui.notify("info", `Reopened #${number}.`, { title: "Issue reopened" });
        } else {
          ctx.ui.notify("error", result.error.message, { title: "Couldn't reopen issue" });
        }
      } finally {
        setUpdatingStatus(false);
      }
    },
    [ctx, service, workspaceId],
  );

  const handleStatusClick = useCallback(
    (anchor: HTMLElement) => {
      if (!detailIssue || view.kind !== "detail" || updatingStatus) return;
      const repoKey = view.repoKey;
      const number = detailIssue.number;

      if (offersReopen(detailIssue)) {
        void confirmAndReopen(repoKey, number);
        return;
      }
      if (!offersClose(detailIssue)) return;

      const items: MenuEntry[] = [
        { label: "Close as completed", run: () => void confirmAndClose(repoKey, number, "completed") },
        { label: "Close as not planned", run: () => void confirmAndClose(repoKey, number, "not planned") },
      ];
      void ctx.ui.showMenu({ items, anchor });
    },
    [ctx, confirmAndClose, confirmAndReopen, detailIssue, updatingStatus, view],
  );

  const openIssue = useCallback(
    (repoKey: string, number: number) => {
      push({ kind: "detail", repoKey, number });
    },
    [push],
  );

  if (!workspaceId) {
    return (
      <div className="ghi">
        <div className="ghi-gate">
          <div className="ghi-gate__title">No active workspace</div>
          <div>Open a workspace to see its issues.</div>
        </div>
      </div>
    );
  }

  if (!initialized || authState === null || authState === "deferred") {
    return (
      <div className="ghi">
        <div className="ghi-gate">
          <div className="ghi-gate__title">Checking GitHub CLI…</div>
        </div>
      </div>
    );
  }

  if (authState === "missing") {
    return (
      <div className="ghi">
        <div className="ghi-gate">
          <div className="ghi-gate__title">GitHub CLI not found</div>
          <div>
            Install the{" "}
            <button
              type="button"
              className="ghi-link"
              onClick={() => void ctx.ui.openExternal("https://cli.github.com")}
            >
              gh CLI
            </button>{" "}
            and restart Silo. The extension retries automatically every{" "}
            {AUTH_RETRY_MINUTES} minutes.
          </div>
        </div>
      </div>
    );
  }

  if (authState === "unauthenticated") {
    return (
      <div className="ghi">
        <div className="ghi-gate">
          <div className="ghi-gate__title">Not authenticated</div>
          <div>
            Run <code>gh auth login</code> in a terminal. The extension will pick it
            up within {AUTH_RETRY_MINUTES} minutes.
          </div>
        </div>
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="ghi">
        <div className="ghi-gate">
          <div className="ghi-gate__title">Monitoring disabled</div>
          <div>Issue monitoring is turned off for this workspace.</div>
          <button
            type="button"
            className="ghi-gate__action"
            onClick={() => store.setWorkspaceEnabled(workspaceId, true)}
          >
            Enable
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ghi">
      <div className="ghi-viewport">
        <div className={`ghi-page ghi-page--${listPageSlot(view)}`}>
          <div className="ghi-header">
            <button
              type="button"
              className="ghi-filter-btn"
              onClick={(e) => openFilterMenu(e.currentTarget)}
            >
              <span className="ghi-filter-btn__label">{FILTER_LABELS[filter]}</span>
              <CaretDown size={12} weight="bold" />
            </button>
            <Tooltip content="Refresh">
              <button
                type="button"
                className={`ghi-icon-btn${refreshing ? " ghi-icon-btn--spinning" : ""}`}
                onClick={() => void handleRefresh()}
                disabled={refreshing}
                aria-label="Refresh"
              >
                <ArrowsClockwise size={14} />
              </button>
            </Tooltip>
          </div>
          <div className="ghi-body">
            <IssueListView
              storage={storage}
              repoStates={repoStates}
              filter={filter}
              viewerLogin={viewerLogin}
              workspaceReady={workspaceReady}
              refreshing={refreshing}
              onOpenIssue={openIssue}
            />
          </div>
        </div>

        {/* Lazily mounted on first open, then left mounted (see lastDetailView)
            so Back's slide-out shows the issue that was open, not a blank page. */}
        <div className={`ghi-page ghi-page--${detailPageSlot(view)}`}>
          {lastDetailView && (
            <>
              <div className="ghi-header ghi-header--detail">
                <div className="ghi-header__toolbar">
                  <button type="button" className="ghi-header__back" onClick={pop}>
                    <CaretLeft size={14} weight="bold" />
                    <span className="ghi-header__back-label">Back</span>
                  </button>
                  {detailIssue && (
                    <div className="ghi-header__actions">
                      <Tooltip content="Open on GitHub">
                        <button
                          type="button"
                          className="ghi-icon-btn"
                          aria-label="Open on GitHub"
                          onClick={() => void ctx.ui.openExternal(detailIssue.url)}
                        >
                          <ArrowSquareOut size={14} />
                        </button>
                      </Tooltip>
                      <Tooltip content="Copy…">
                        <button
                          type="button"
                          className="ghi-icon-btn"
                          aria-label="Copy actions"
                          onClick={(e) => openOverflowMenu(e.currentTarget)}
                        >
                          <DotsThreeVertical size={14} />
                        </button>
                      </Tooltip>
                    </div>
                  )}
                </div>
                <div className="ghi-header__title-row">
                  <div className="ghi-header__title">
                    #{lastDetailView.number}
                    {detailIssue ? ` · ${detailIssue.title}` : ""}
                  </div>
                  {detailIssue && (
                    <div className="ghi-header__cta">
                      <button
                        type="button"
                        className="ghi-open-btn"
                        aria-label="Open on GitHub"
                        onClick={() => void ctx.ui.openExternal(detailIssue.url)}
                      >
                        Open
                      </button>
                      {(offersClose(detailIssue) || offersReopen(detailIssue)) && (
                        <StatusButton
                          label={
                            updatingStatus
                              ? "Updating…"
                              : offersReopen(detailIssue)
                                ? "Reopen"
                                : "Close"
                          }
                          busy={updatingStatus}
                          onClick={handleStatusClick}
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="ghi-body">
                {detailIssue ? (
                  <IssueDetailView
                    ctx={ctx}
                    issue={detailIssue}
                    detailEntry={detailEntry}
                    detailError={detailError}
                    loadingDetail={loadingDetail}
                  />
                ) : (
                  <div className="ghi-empty">
                    <div className="ghi-empty__title">Issue not found</div>
                    <div>It may be outside the current filter.</div>
                    <button type="button" className="ghi-link" onClick={pop}>
                      Back to list
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

