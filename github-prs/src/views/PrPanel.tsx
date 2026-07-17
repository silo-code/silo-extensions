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
import { FILTER_LABELS, PR_FILTERS, type PrFilter } from "../filters";
import { buildCopyActions } from "../copy-actions";
import { findPrInRepoStates } from "../detail-helpers";
import { usePrStore } from "../hooks";
import { AUTH_RETRY_MINUTES, type PrService } from "../pr-service";
import { useViewStack } from "./use-view-stack";
import { PrListView } from "./PrListView";
import { PrDetailView } from "./PrDetailView";

export interface PrPanelProps extends SidePanelProps {
  ctx: ExtensionContext;
  service: PrService;
}

export function PrPanel({ ctx, service, storage, hydrated, active }: PrPanelProps) {
  const { view, push, pop } = useViewStack(storage, hydrated);
  const wsState = useServiceState(ctx.workspaces);
  const workspaceId = wsState.activeId ?? "";
  const store = usePrStore();

  const [refreshing, setRefreshing] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const filter = workspaceId ? store.getWorkspaceFilter(workspaceId) : "authored";
  const enabled = workspaceId ? store.getWorkspaceEnabled(workspaceId) : true;
  const repoStates = workspaceId ? store.getRepoStates(workspaceId) : [];
  const workspaceReady = workspaceId ? store.isWorkspaceReady(workspaceId) : false;
  const viewerLogin = store.viewerLogin;
  const authState = store.authState;
  const initialized = store.initialized;

  const detailPr = useMemo(() => {
    if (view.kind !== "detail") return null;
    return findPrInRepoStates(repoStates, view.folder, view.number);
  }, [view, repoStates]);

  const detailEntry =
    view.kind === "detail" ? store.getDetail(view.folder, view.number) : undefined;
  const detailError =
    view.kind === "detail" ? store.getDetailError(view.folder, view.number) : undefined;

  useEffect(() => {
    if (view.kind !== "detail" || !active) {
      setLoadingDetail(false);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    void service.fetchDetail(view.folder, view.number).finally(() => {
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
    setRefreshing(true);
    await service.refreshWorkspace(workspaceId);
    setRefreshing(false);
  }, [service, workspaceId]);

  const handleFilter = useCallback(
    (next: PrFilter) => {
      if (!workspaceId) return;
      store.setWorkspaceFilter(workspaceId, next);
    },
    [workspaceId, store],
  );

  const openFilterMenu = useCallback(
    (anchor: HTMLElement) => {
      const items: MenuEntry[] = PR_FILTERS.map((f) => ({
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
      if (!detailPr) return;
      const items: MenuEntry[] = buildCopyActions(detailPr).map((a) => ({
        label: a.label,
        run: () => {
          void navigator.clipboard.writeText(a.text).then(() => {
            ctx.ui.notify("info", "Copied to clipboard.");
          });
        },
      }));
      void ctx.ui.showMenu({ items, anchor });
    },
    [ctx, detailPr],
  );

  const openPr = useCallback(
    (folder: string, number: number) => {
      push({ kind: "detail", folder, number });
    },
    [push],
  );

  if (!workspaceId) {
    return (
      <div className="ghpr">
        <div className="ghpr-gate">
          <div className="ghpr-gate__title">No active workspace</div>
          <div>Open a workspace to see its pull requests.</div>
        </div>
      </div>
    );
  }

  if (!initialized || authState === null || authState === "deferred") {
    return (
      <div className="ghpr">
        <div className="ghpr-gate">
          <div className="ghpr-gate__title">Checking GitHub CLI…</div>
        </div>
      </div>
    );
  }

  if (authState === "missing") {
    return (
      <div className="ghpr">
        <div className="ghpr-gate">
          <div className="ghpr-gate__title">GitHub CLI not found</div>
          <div>
            Install the{" "}
            <button
              type="button"
              className="ghpr-link"
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
      <div className="ghpr">
        <div className="ghpr-gate">
          <div className="ghpr-gate__title">Not authenticated</div>
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
      <div className="ghpr">
        <div className="ghpr-gate">
          <div className="ghpr-gate__title">Monitoring disabled</div>
          <div>Pull request monitoring is turned off for this workspace.</div>
          <button
            type="button"
            className="ghpr-gate__action"
            onClick={() => store.setWorkspaceEnabled(workspaceId, true)}
          >
            Enable
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ghpr">
      <div className="ghpr-header">
        {view.kind === "list" ? (
          <>
            <button
              type="button"
              className="ghpr-filter-btn"
              onClick={(e) => openFilterMenu(e.currentTarget)}
            >
              <span className="ghpr-filter-btn__label">{FILTER_LABELS[filter]}</span>
              <CaretDown size={12} weight="bold" />
            </button>
            <Tooltip content="Refresh">
              <button
                type="button"
                className={`ghpr-icon-btn${refreshing ? " ghpr-icon-btn--spinning" : ""}`}
                onClick={() => void handleRefresh()}
                disabled={refreshing}
                aria-label="Refresh"
              >
                <ArrowsClockwise size={16} />
              </button>
            </Tooltip>
          </>
        ) : (
          <div className="ghpr-header__detail">
            <div className="ghpr-header__toolbar">
              <button type="button" className="ghpr-header__back" onClick={pop}>
                <CaretLeft size={16} />
                <span className="ghpr-header__back-label">Back</span>
              </button>
              {detailPr && (
                <div className="ghpr-header__actions">
                  <Tooltip content="Open on GitHub">
                    <button
                      type="button"
                      className="ghpr-icon-btn"
                      aria-label="Open on GitHub"
                      onClick={() => void ctx.ui.openExternal(detailPr.url)}
                    >
                      <ArrowSquareOut size={16} />
                    </button>
                  </Tooltip>
                  <Tooltip content="Copy…">
                    <button
                      type="button"
                      className="ghpr-icon-btn"
                      aria-label="Copy actions"
                      onClick={(e) => openOverflowMenu(e.currentTarget)}
                    >
                      <DotsThreeVertical size={18} weight="bold" />
                    </button>
                  </Tooltip>
                </div>
              )}
            </div>
            <div className="ghpr-header__title">
              #{view.number}
              {detailPr ? ` · ${detailPr.title}` : ""}
            </div>
          </div>
        )}
      </div>

      <div className="ghpr-body">
        {view.kind === "list" ? (
          <PrListView
            storage={storage}
            repoStates={repoStates}
            filter={filter}
            viewerLogin={viewerLogin}
            workspaceReady={workspaceReady}
            onOpenPr={openPr}
          />
        ) : detailPr ? (
          <PrDetailView
            ctx={ctx}
            pr={detailPr}
            detailEntry={detailEntry}
            detailError={detailError}
            loadingDetail={loadingDetail}
          />
        ) : (
          <div className="ghpr-empty">
            <div className="ghpr-empty__title">Pull request not found</div>
            <div>It may have been closed or is outside the current filter.</div>
            <button type="button" className="ghpr-link" onClick={pop}>
              Back to list
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
