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
import {
  allowedMergeMethods,
  MERGE_METHOD_LABELS,
  mergeConfirmCopy,
  type MergeMethod,
} from "../merge-methods";
import { AUTH_RETRY_MINUTES, type PrService } from "../pr-service";
import {
  isMergeReady,
  mergeBlockReason,
  offersMerge,
} from "../status";
import { useViewStack } from "./use-view-stack";
import { PrListView } from "./PrListView";
import { PrDetailView } from "./PrDetailView";
import { PrCommitsView } from "./PrCommitsView";
import { PrCommitView } from "./PrCommitView";
import { PrFilesView } from "./PrFilesView";
import { PrReviewView } from "./PrReviewView";
import {
  commitPageSlot,
  commitsPageSlot,
  detailPageSlot,
  filesPageSlot,
  listPageSlot,
  reviewPageSlot,
} from "./page-slots";
import type { PanelView } from "../view-stack";

/** Any view that carries a `repoKey`/`number` — the detail, commits, commit,
 * files, and review pages all show data for the same underlying PR. */
type PrContextView = Extract<
  PanelView,
  { kind: "detail" | "commits" | "commit" | "files" | "review" }
>;

export interface PrPanelProps extends SidePanelProps {
  ctx: ExtensionContext;
  service: PrService;
}

function MergeButton({
  reason,
  enabled,
  merging,
  onMerge,
}: {
  reason: string | null;
  enabled: boolean;
  merging: boolean;
  onMerge: (anchor: HTMLElement) => void;
}) {
  const label = merging ? "Merging…" : "Merge";
  return (
    <Tooltip content={reason ?? ""} disabled={!reason}>
      <button
        type="button"
        className="ghpr-merge-btn"
        disabled={!enabled || merging}
        aria-label={reason ? `Merge unavailable: ${reason}` : label}
        onClick={(e) => onMerge(e.currentTarget)}
      >
        {label}
      </button>
    </Tooltip>
  );
}

export function PrPanel({ ctx, service, storage, hydrated, active }: PrPanelProps) {
  const { view, push, pop } = useViewStack(storage, hydrated);
  const wsState = useServiceState(ctx.workspaces);
  const workspaceId = wsState.activeId ?? "";
  const store = usePrStore();

  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingCommitDetail, setLoadingCommitDetail] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingReviewComments, setLoadingReviewComments] = useState(false);
  const [merging, setMerging] = useState(false);

  const filter = workspaceId ? store.getWorkspaceFilter(workspaceId) : "authored";
  const enabled = workspaceId ? store.getWorkspaceEnabled(workspaceId) : true;
  const repoStates = workspaceId ? store.getRepoStates(workspaceId) : [];
  const workspaceReady = workspaceId ? store.isWorkspaceReady(workspaceId) : false;
  const refreshing = workspaceId ? store.isWorkspaceRefreshing(workspaceId) : false;
  const viewerLogin = store.viewerLogin;
  const authState = store.authState;
  const initialized = store.initialized;

  // The detail/commits/commit pages keep rendering their last-open PR while
  // parked off-screen mid-slide (see the render below) — tracked separately
  // from `view` so popping back doesn't blank a page the instant Back is
  // pressed, before the slide-out transition finishes. All three pages show
  // data for the same PR, so one repoKey/number tracker covers them.
  const [lastPrView, setLastPrView] = useState<PrContextView | null>(
    view.kind !== "list" ? view : null,
  );
  useEffect(() => {
    if (view.kind !== "list") setLastPrView(view);
  }, [view]);

  const [lastCommitView, setLastCommitView] = useState<Extract<
    PanelView,
    { kind: "commit" }
  > | null>(view.kind === "commit" ? view : null);
  useEffect(() => {
    if (view.kind === "commit") setLastCommitView(view);
  }, [view]);

  const [lastReviewView, setLastReviewView] = useState<Extract<
    PanelView,
    { kind: "review" }
  > | null>(view.kind === "review" ? view : null);
  useEffect(() => {
    if (view.kind === "review") setLastReviewView(view);
  }, [view]);

  const detailPr = useMemo(() => {
    if (!lastPrView) return null;
    return findPrInRepoStates(repoStates, lastPrView.repoKey, lastPrView.number);
  }, [lastPrView, repoStates]);

  const detailEntry = lastPrView
    ? store.getDetail(lastPrView.repoKey, lastPrView.number)
    : undefined;
  const detailError = lastPrView
    ? store.getDetailError(lastPrView.repoKey, lastPrView.number)
    : undefined;

  const commitDetailEntry = lastCommitView
    ? store.getCommitDetail(lastCommitView.repoKey, lastCommitView.sha)
    : undefined;
  const commitDetailError = lastCommitView
    ? store.getCommitDetailError(lastCommitView.repoKey, lastCommitView.sha)
    : undefined;
  const commitCwd = lastCommitView ? service.resolveCwd(lastCommitView.repoKey) : null;

  const filesEntry = lastPrView ? store.getFiles(lastPrView.repoKey, lastPrView.number) : undefined;
  const filesError = lastPrView ? store.getFilesError(lastPrView.repoKey, lastPrView.number) : undefined;
  const filesCwd = lastPrView ? service.resolveCwd(lastPrView.repoKey) : null;

  // No fetch/cache of its own — reviews already live on the cached PrDetail
  // (the detail page had to load it to render the row that got clicked).
  // Keyed off `lastReviewView` (the "keep last content visible while
  // parked" tracker), which lags `view` by one render right after a click —
  // fine for *display*, since the old review's content staying up one frame
  // longer is invisible. NOT fine as the fetch effect's correlation input
  // (see `activeReview` below) — that one render of staleness was enough to
  // fetch review B's comments using review A's author+submittedAt as the
  // correlation key, silently writing review A's comment into review B's
  // cache slot.
  const selectedReview = lastReviewView
    ? detailEntry?.detail.reviews.find((r) => r.id === lastReviewView.reviewId)
    : undefined;
  // The fetch effect's own source of truth — keyed off `view` (never lags)
  // so the id passed to fetchReviewComments and the author/submittedAt used
  // to correlate it against the REST reviews list always describe the same
  // review, even during the render where lastReviewView hasn't caught up yet.
  const activeReview = view.kind === "review"
    ? detailEntry?.detail.reviews.find((r) => r.id === view.reviewId)
    : undefined;
  // Primitives pulled out for the fetch effect's dependency array below —
  // `activeReview` itself is a fresh `.find()` result every render (not
  // memoized), so depending on the object directly re-ran the fetch (and
  // re-flashed the loading state) far more often than the review actually
  // changed. Depending on the two values the fetch call actually uses fixes
  // that: same author + same submittedAt now means "same review, don't refetch".
  const activeReviewAuthorLogin = activeReview?.author?.login ?? null;
  const activeReviewSubmittedAt = activeReview?.submittedAt ?? null;

  const reviewCommentsEntry = lastReviewView
    ? store.getReviewComments(lastReviewView.repoKey, lastReviewView.reviewId)
    : undefined;
  const reviewCommentsError = lastReviewView
    ? store.getReviewCommentsError(lastReviewView.repoKey, lastReviewView.reviewId)
    : undefined;

  useEffect(() => {
    if (view.kind === "list" || !active) {
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
    if (view.kind !== "commit" || !active) {
      setLoadingCommitDetail(false);
      return;
    }
    let cancelled = false;
    setLoadingCommitDetail(true);
    void service.fetchCommitDetail(view.repoKey, view.sha).finally(() => {
      if (!cancelled) setLoadingCommitDetail(false);
    });
    return () => {
      cancelled = true;
      setLoadingCommitDetail(false);
    };
  }, [view, service, active]);

  useEffect(() => {
    if (view.kind !== "files" || !active) {
      setLoadingFiles(false);
      return;
    }
    let cancelled = false;
    setLoadingFiles(true);
    void service.fetchFiles(view.repoKey, view.number).finally(() => {
      if (!cancelled) setLoadingFiles(false);
    });
    return () => {
      cancelled = true;
      setLoadingFiles(false);
    };
  }, [view, service, active]);

  useEffect(() => {
    // activeReview may still be undefined on first render of a "review" view
    // (e.g. restored from persisted state) until the detail fetch effect
    // above resolves — this effect re-runs once it does, since
    // activeReviewAuthorLogin/SubmittedAt flip from null to real values in
    // that same render.
    //
    // Deliberately keyed off `view`/`activeReview*`, NOT `selectedReview`/
    // `lastReviewView` — those lag `view` by one render right after a click
    // (intentional, so the previous review's content stays visible while
    // parked off-screen mid-transition). Using them here caused a real bug:
    // for one render, `view.reviewId` had already advanced to the newly
    // clicked review while `selectedReviewAuthorLogin`/`SubmittedAt` still
    // described the *previous* one. fetchReviewComments correlates the id
    // against GitHub's REST reviews by author+submittedAt — with a
    // mismatched pair, it matched the previous review's REST entry and
    // silently wrote *its* comments into the new review's cache slot.
    if (view.kind !== "review" || !active || !activeReview) {
      setLoadingReviewComments(false);
      return;
    }
    let cancelled = false;
    setLoadingReviewComments(true);
    void service
      .fetchReviewComments(
        view.repoKey,
        view.number,
        view.reviewId,
        activeReviewAuthorLogin,
        activeReviewSubmittedAt,
      )
      .finally(() => {
        if (!cancelled) setLoadingReviewComments(false);
      });
    return () => {
      cancelled = true;
      setLoadingReviewComments(false);
    };
    // Deliberately not depending on `activeReview` itself — it's a fresh
    // .find() result every render (unmemoized), so depending on the object
    // reference re-ran this effect (and re-flashed the loading state) far
    // more often than the review actually changed. The two primitives below
    // are what the fetch call actually uses, and are what should trigger a
    // refetch when they change.
  }, [view, service, active, activeReviewAuthorLogin, activeReviewSubmittedAt]);

  useEffect(() => {
    if (!active) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && view.kind !== "list") {
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

  // Shared by the detail and commits pages' Refresh buttons — both show data
  // from the same PrDetail fetch. Routed through this (rather than each
  // button calling service.fetchDetail directly) so loadingDetail — and thus
  // the button's spin — actually reflects an in-flight manual refresh, not
  // just the one the view-change effect above tracks.
  const refreshDetail = useCallback(async () => {
    if (!lastPrView) return;
    setLoadingDetail(true);
    try {
      await service.fetchDetail(lastPrView.repoKey, lastPrView.number);
    } finally {
      setLoadingDetail(false);
    }
  }, [lastPrView, service]);

  // Separate from refreshDetail: files+merge-base is its own fetch/cache,
  // not part of PrDetail, so it needs its own loading flag to spin correctly.
  const refreshFiles = useCallback(async () => {
    if (!lastPrView) return;
    setLoadingFiles(true);
    try {
      await service.fetchFiles(lastPrView.repoKey, lastPrView.number);
    } finally {
      setLoadingFiles(false);
    }
  }, [lastPrView, service]);

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

  const confirmAndMerge = useCallback(
    async (repoKey: string, method: MergeMethod) => {
      if (!detailPr || !workspaceId) return;
      const copy = mergeConfirmCopy(detailPr, method);
      const confirmed = await ctx.ui.confirm({
        title: copy.title,
        body: copy.body,
        confirmLabel: copy.confirmLabel,
      });
      if (!confirmed) return;

      setMerging(true);
      try {
        const result = await service.mergePullRequest(
          workspaceId,
          repoKey,
          detailPr.number,
          method,
        );
        if (result.ok) {
          ctx.ui.notify("info", `Merged #${detailPr.number}.`, { title: "Pull request merged" });
          pop();
        } else {
          ctx.ui.notify("error", result.error.message, { title: "Couldn't merge pull request" });
        }
      } finally {
        setMerging(false);
      }
    },
    [ctx, detailPr, pop, service, workspaceId],
  );

  const handleMergeClick = useCallback(
    async (anchor: HTMLElement) => {
      if (!detailPr || view.kind !== "detail" || !isMergeReady(detailPr) || merging) return;
      const repoKey = view.repoKey;

      const methodsResult = await service.fetchMergeMethods(repoKey);
      if (!methodsResult.ok) {
        ctx.ui.notify("error", methodsResult.error.message, {
          title: "Couldn't load merge options",
        });
        return;
      }

      const methods = allowedMergeMethods(methodsResult.methods);
      if (methods.length === 0) {
        ctx.ui.notify("error", "No merge methods are enabled on this repository.", {
          title: "Couldn't merge pull request",
        });
        return;
      }

      if (methods.length === 1) {
        await confirmAndMerge(repoKey, methods[0]);
        return;
      }

      const items: MenuEntry[] = methods.map((method) => ({
        label: MERGE_METHOD_LABELS[method],
        run: () => {
          void confirmAndMerge(repoKey, method);
        },
      }));
      void ctx.ui.showMenu({ items, anchor });
    },
    [confirmAndMerge, ctx, detailPr, merging, service, view],
  );

  const openPr = useCallback(
    (repoKey: string, number: number) => {
      push({ kind: "detail", repoKey, number });
    },
    [push],
  );

  const openCommits = useCallback(
    (repoKey: string, number: number) => {
      push({ kind: "commits", repoKey, number });
    },
    [push],
  );

  const openCommit = useCallback(
    (repoKey: string, number: number, sha: string) => {
      push({ kind: "commit", repoKey, number, sha });
    },
    [push],
  );

  const openFiles = useCallback(
    (repoKey: string, number: number) => {
      push({ kind: "files", repoKey, number });
    },
    [push],
  );

  const openReview = useCallback(
    (repoKey: string, number: number, reviewId: string) => {
      push({ kind: "review", repoKey, number, reviewId });
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
      <div className="ghpr-viewport">
        <div className={`ghpr-page ghpr-page--${listPageSlot(view)}`}>
          <div className="ghpr-header">
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
                <ArrowsClockwise size={14} />
              </button>
            </Tooltip>
          </div>
          <div className="ghpr-body">
            <PrListView
              storage={storage}
              repoStates={repoStates}
              filter={filter}
              viewerLogin={viewerLogin}
              workspaceReady={workspaceReady}
              refreshing={refreshing}
              onOpenPr={openPr}
            />
          </div>
        </div>

        {/* Lazily mounted on first open, then left mounted (see lastPrView)
            so Back's slide-out shows the PR that was open, not a blank page. */}
        <div className={`ghpr-page ghpr-page--${detailPageSlot(view)}`}>
          {lastPrView && (
            <>
              <div className="ghpr-header ghpr-header--detail">
                <div className="ghpr-header__toolbar">
                  <button type="button" className="ghpr-header__back" onClick={pop}>
                    <CaretLeft size={14} weight="bold" />
                    <span className="ghpr-header__back-label">Back</span>
                  </button>
                  <div className="ghpr-header__actions">
                    <Tooltip content="Refresh">
                      <button
                        type="button"
                        className={`ghpr-icon-btn${loadingDetail ? " ghpr-icon-btn--spinning" : ""}`}
                        onClick={() => void refreshDetail()}
                        disabled={loadingDetail}
                        aria-label="Refresh"
                      >
                        <ArrowsClockwise size={14} />
                      </button>
                    </Tooltip>
                    {detailPr && (
                      <>
                        <Tooltip content="Open on GitHub">
                          <button
                            type="button"
                            className="ghpr-icon-btn"
                            aria-label="Open on GitHub"
                            onClick={() => void ctx.ui.openExternal(detailPr.url)}
                          >
                            <ArrowSquareOut size={14} />
                          </button>
                        </Tooltip>
                        <Tooltip content="Copy…">
                          <button
                            type="button"
                            className="ghpr-icon-btn"
                            aria-label="Copy actions"
                            onClick={(e) => openOverflowMenu(e.currentTarget)}
                          >
                            <DotsThreeVertical size={14} />
                          </button>
                        </Tooltip>
                      </>
                    )}
                  </div>
                </div>
                <div className="ghpr-header__title-row">
                  <div className="ghpr-header__title">
                    #{lastPrView.number}
                    {detailPr ? ` · ${detailPr.title}` : ""}
                  </div>
                  {detailPr && (
                    <div className="ghpr-header__cta">
                      <button
                        type="button"
                        className="ghpr-open-btn"
                        aria-label="Open on GitHub"
                        onClick={() => void ctx.ui.openExternal(detailPr.url)}
                      >
                        Open
                      </button>
                      {offersMerge(detailPr) && (
                        <MergeButton
                          reason={mergeBlockReason(detailPr)}
                          enabled={isMergeReady(detailPr)}
                          merging={merging}
                          onMerge={(anchor) => void handleMergeClick(anchor)}
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="ghpr-body">
                {detailPr ? (
                  <PrDetailView
                    ctx={ctx}
                    pr={detailPr}
                    detailEntry={detailEntry}
                    detailError={detailError}
                    loadingDetail={loadingDetail}
                    onViewCommits={() => openCommits(lastPrView.repoKey, lastPrView.number)}
                    onViewFiles={() => openFiles(lastPrView.repoKey, lastPrView.number)}
                    onSelectReview={(reviewId) =>
                      openReview(lastPrView.repoKey, lastPrView.number, reviewId)
                    }
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
            </>
          )}
        </div>

        {/* Commits list — pushed from the detail page's "Commits" section. */}
        <div className={`ghpr-page ghpr-page--${commitsPageSlot(view)}`}>
          {lastPrView && (
            <>
              <div className="ghpr-header ghpr-header--detail">
                <div className="ghpr-header__toolbar">
                  <button type="button" className="ghpr-header__back" onClick={pop}>
                    <CaretLeft size={14} weight="bold" />
                    <span className="ghpr-header__back-label">Back</span>
                  </button>
                  <div className="ghpr-header__actions">
                    <Tooltip content="Refresh">
                      <button
                        type="button"
                        className={`ghpr-icon-btn${loadingDetail ? " ghpr-icon-btn--spinning" : ""}`}
                        onClick={() => void refreshDetail()}
                        disabled={loadingDetail}
                        aria-label="Refresh"
                      >
                        <ArrowsClockwise size={14} />
                      </button>
                    </Tooltip>
                  </div>
                </div>
                <div className="ghpr-header__title">Commits</div>
              </div>
              <div className="ghpr-body">
                <PrCommitsView
                  commits={detailEntry?.detail.commits ?? []}
                  loading={loadingDetail}
                  error={detailError && !detailEntry ? detailError.error.message : null}
                  onSelectCommit={(sha) => openCommit(lastPrView.repoKey, lastPrView.number, sha)}
                />
              </div>
            </>
          )}
        </div>

        {/* One commit's message + changed files — pushed from the commits list. */}
        <div className={`ghpr-page ghpr-page--${commitPageSlot(view)}`}>
          {lastCommitView && (
            <>
              <div className="ghpr-header">
                <div className="ghpr-header__toolbar">
                  <button type="button" className="ghpr-header__back" onClick={pop}>
                    <CaretLeft size={14} weight="bold" />
                    <span className="ghpr-header__back-label">Back</span>
                  </button>
                </div>
                <div className="ghpr-header__title">Commit</div>
              </div>
              <div className="ghpr-body">
                <PrCommitView
                  ctx={ctx}
                  owner={lastCommitView.repoKey.split("/")[0] ?? ""}
                  repo={lastCommitView.repoKey.split("/")[1] ?? ""}
                  cwd={commitCwd}
                  detail={commitDetailEntry?.detail}
                  loading={loadingCommitDetail}
                  error={
                    commitDetailError && !commitDetailEntry ? commitDetailError.error.message : null
                  }
                />
              </div>
            </>
          )}
        </div>

        {/* The PR's overall changed files — pushed from the detail page's
            "Files changed" section (a sibling of Commits, not nested under it). */}
        <div className={`ghpr-page ghpr-page--${filesPageSlot(view)}`}>
          {lastPrView && (
            <>
              <div className="ghpr-header ghpr-header--detail">
                <div className="ghpr-header__toolbar">
                  <button type="button" className="ghpr-header__back" onClick={pop}>
                    <CaretLeft size={14} weight="bold" />
                    <span className="ghpr-header__back-label">Back</span>
                  </button>
                  <div className="ghpr-header__actions">
                    <Tooltip content="Refresh">
                      <button
                        type="button"
                        className={`ghpr-icon-btn${loadingFiles ? " ghpr-icon-btn--spinning" : ""}`}
                        onClick={() => void refreshFiles()}
                        disabled={loadingFiles}
                        aria-label="Refresh"
                      >
                        <ArrowsClockwise size={14} />
                      </button>
                    </Tooltip>
                  </div>
                </div>
                <div className="ghpr-header__title">Files changed</div>
              </div>
              <div className="ghpr-body">
                <PrFilesView
                  ctx={ctx}
                  owner={lastPrView.repoKey.split("/")[0] ?? ""}
                  repo={lastPrView.repoKey.split("/")[1] ?? ""}
                  cwd={filesCwd}
                  files={filesEntry?.files ?? []}
                  baseSha={filesEntry?.baseSha ?? null}
                  headSha={filesEntry?.headSha ?? null}
                  loading={loadingFiles}
                  error={filesError && !filesEntry ? filesError.error.message : null}
                />
              </div>
            </>
          )}
        </div>

        {/* One review's full body — pushed from a review row on the detail
            page (another sibling of Commits, not nested under it). No fetch
            of its own; refresh here re-fetches PrDetail like the detail page. */}
        <div className={`ghpr-page ghpr-page--${reviewPageSlot(view)}`}>
          {lastReviewView && (
            <>
              <div className="ghpr-header ghpr-header--detail">
                <div className="ghpr-header__toolbar">
                  <button type="button" className="ghpr-header__back" onClick={pop}>
                    <CaretLeft size={14} weight="bold" />
                    <span className="ghpr-header__back-label">Back</span>
                  </button>
                  <div className="ghpr-header__actions">
                    <Tooltip content="Refresh">
                      <button
                        type="button"
                        className={`ghpr-icon-btn${loadingDetail ? " ghpr-icon-btn--spinning" : ""}`}
                        onClick={() => void refreshDetail()}
                        disabled={loadingDetail}
                        aria-label="Refresh"
                      >
                        <ArrowsClockwise size={14} />
                      </button>
                    </Tooltip>
                  </div>
                </div>
                <div className="ghpr-header__title">Review</div>
              </div>
              <div className="ghpr-body">
                <PrReviewView
                  ctx={ctx}
                  review={selectedReview}
                  threads={reviewCommentsEntry?.threads ?? []}
                  loadingComments={loadingReviewComments}
                  commentsError={
                    reviewCommentsError && !reviewCommentsEntry ? reviewCommentsError.error.message : null
                  }
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
