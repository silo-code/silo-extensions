import { useMemo, useState } from "react";
import {
  CaretDown,
  CaretRight,
  CheckCircle,
  CircleNotch,
  ClockCountdown,
  XCircle,
} from "@phosphor-icons/react";
import type { ExtensionContext } from "@silo-code/sdk";
import type { CheckContext, PrListItem } from "../github-pr-api";
import {
  REVIEW_STATE_LABELS,
  checkName,
  checkUrl,
  classifyCheck,
  deriveReviewState,
  hasConflicts,
  splitChecksByOutcome,
  type CheckOutcome,
} from "../status";
import { formatElapsed } from "../format-elapsed";
import {
  buildTimeline,
  checkKey,
  resolvedReviews,
  reviewKindLabel,
} from "../detail-helpers";
import type { DetailCacheEntry, DetailErrorEntry } from "../store";
import { GithubMarkdown } from "./GithubMarkdown";

export interface PrDetailViewProps {
  ctx: ExtensionContext;
  pr: PrListItem;
  detailEntry: DetailCacheEntry | undefined;
  detailError: DetailErrorEntry | undefined;
  loadingDetail: boolean;
  onViewCommits: () => void;
  onViewFiles: () => void;
  onSelectReview: (reviewId: string) => void;
}

function checkIcon(outcome: CheckOutcome) {
  switch (outcome) {
    case "passing":
      return <CheckCircle size={14} weight="fill" className="ghpr-row__icon--ok" />;
    case "failing":
      return <XCircle size={14} weight="fill" className="ghpr-row__icon--err" />;
    case "pending":
      return <CircleNotch size={14} weight="bold" className="ghpr-row__icon--warn ghpr-pulse" />;
  }
}

function renderCheckRow(check: CheckContext, ctx: ExtensionContext) {
  const outcome = classifyCheck(check);
  const url = checkUrl(check);
  const name = checkName(check);
  const workflow = check.__typename === "CheckRun" && check.workflowName ? check.workflowName : null;
  return (
    <button
      key={checkKey(check)}
      type="button"
      className="ghpr-check-row"
      disabled={!url}
      onClick={() => {
        if (url) void ctx.ui.openExternal(url);
      }}
    >
      {checkIcon(outcome)}
      <span className="ghpr-check-row__name">
        {name}
        {workflow && <span className="ghpr-check-row__workflow">{workflow}</span>}
      </span>
    </button>
  );
}

export function reviewStateIcon(state: string) {
  switch (state) {
    case "APPROVED":
      return <CheckCircle size={14} weight="fill" className="ghpr-row__icon--ok" />;
    case "CHANGES_REQUESTED":
      return <XCircle size={14} weight="fill" className="ghpr-row__icon--err" />;
    case "COMMENTED":
      return <ClockCountdown size={14} weight="fill" className="ghpr-row__icon--muted" />;
    default:
      return <ClockCountdown size={14} weight="regular" className="ghpr-row__icon--muted" />;
  }
}

export function PrDetailView({
  ctx,
  pr,
  detailEntry,
  detailError,
  loadingDetail,
  onViewCommits,
  onViewFiles,
  onSelectReview,
}: PrDetailViewProps) {
  const detail = detailEntry?.detail;
  const review = deriveReviewState(pr);
  const checks = pr.statusCheckRollup;
  // Passing checks are collapsed behind a toggle by default — a big PR can
  // carry dozens of them, and the ones that actually need a look (failing,
  // still running) are what should be visible without scrolling past a wall
  // of green.
  const [showPassingChecks, setShowPassingChecks] = useState(false);
  const { passing: passingChecks, other: otherChecks } = useMemo(
    () => splitChecksByOutcome(checks),
    [checks],
  );
  const reviews = useMemo(() => resolvedReviews(pr, detail), [pr, detail]);
  const timeline = useMemo(() => (detail ? buildTimeline(detail) : []), [detail]);
  const requested = pr.reviewRequests
    .map((r) => r.login ?? r.name)
    .filter((x): x is string => !!x);

  const showDetailError = !!detailError && !detail;

  return (
    <div className="ghpr-detail">
      <section className="ghpr-detail__section">
        <div className="ghpr-detail__meta">
          <span>
            <strong>{REVIEW_STATE_LABELS[review]}</strong>
          </span>
          {pr.author?.login && <span>by {pr.author.login}</span>}
          {hasConflicts(pr) && <span className="ghpr-chip ghpr-chip--err">Conflicts</span>}
          <span className="ghpr-detail__branch">
            {pr.headRefName} → {pr.baseRefName}
          </span>
          <span className="ghpr-detail__stats">
            <span className="ghpr-detail__add">+{pr.additions}</span>{" "}
            <span className="ghpr-detail__del">−{pr.deletions}</span>
          </span>
        </div>
      </section>

      {showDetailError && (
        <div className="ghpr-error-banner">{detailError.error.message}</div>
      )}

      <section className="ghpr-detail__section">
        <h3 className="ghpr-detail__section-title">Commits</h3>
        <button type="button" className="ghpr-nav-row" onClick={onViewCommits}>
          <span className="ghpr-nav-row__label">
            {detail
              ? `${detail.commits.length} commit${detail.commits.length === 1 ? "" : "s"}`
              : "View commits"}
          </span>
          <CaretRight size={14} weight="bold" className="ghpr-nav-row__chevron" />
        </button>
      </section>

      <section className="ghpr-detail__section">
        <h3 className="ghpr-detail__section-title">Files changed</h3>
        <button type="button" className="ghpr-nav-row" onClick={onViewFiles}>
          <span className="ghpr-nav-row__label">
            {detail?.changedFiles != null
              ? `${detail.changedFiles} file${detail.changedFiles === 1 ? "" : "s"}`
              : "View files"}
          </span>
          <CaretRight size={14} weight="bold" className="ghpr-nav-row__chevron" />
        </button>
      </section>

      <section className="ghpr-detail__section">
        <h3 className="ghpr-detail__section-title">Checks</h3>
        {checks.length === 0 ? (
          <div className="ghpr-detail__loading">No checks reported.</div>
        ) : (
          <>
            {otherChecks.map((check) => renderCheckRow(check, ctx))}
            {passingChecks.length > 0 && (
              <button
                type="button"
                className="ghpr-checks-toggle"
                onClick={() => setShowPassingChecks((v) => !v)}
                aria-expanded={showPassingChecks}
              >
                {showPassingChecks ? (
                  <CaretDown size={12} weight="bold" />
                ) : (
                  <CaretRight size={12} weight="bold" />
                )}
                {showPassingChecks
                  ? `Hide ${passingChecks.length} passing`
                  : `Show ${passingChecks.length} more passing`}
              </button>
            )}
            {showPassingChecks && passingChecks.map((check) => renderCheckRow(check, ctx))}
          </>
        )}
      </section>

      <section className="ghpr-detail__section">
        <h3 className="ghpr-detail__section-title">Reviews</h3>
        {reviews.length === 0 && requested.length === 0 ? (
          <div className="ghpr-detail__loading">No reviewers yet.</div>
        ) : (
          <>
            {reviews.map((r) => (
              <div
                key={r.id || (r.author?.login ?? r.submittedAt)}
                className="ghpr-review-row"
                role="button"
                tabIndex={0}
                onClick={() => r.id && onSelectReview(r.id)}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && r.id) {
                    e.preventDefault();
                    onSelectReview(r.id);
                  }
                }}
              >
                {reviewStateIcon(r.state)}
                <span>
                  <span className="ghpr-timeline-row__who">{r.author?.login ?? "unknown"}</span>
                  {" · "}
                  {reviewKindLabel(r.state)}
                  {r.submittedAt && (
                    <span className="ghpr-timeline-row__when">
                      {" "}
                      · {formatElapsed(new Date(r.submittedAt))}
                    </span>
                  )}
                </span>
              </div>
            ))}
            {requested.length > 0 && (
              <div className="ghpr-detail__loading">
                Requested: {requested.join(", ")}
              </div>
            )}
          </>
        )}
      </section>

      <section className="ghpr-detail__section">
        <h3 className="ghpr-detail__section-title">Description</h3>
        {showDetailError ? (
          <div className="ghpr-detail__loading">Couldn’t load description.</div>
        ) : loadingDetail && !detail ? (
          <div className="ghpr-detail__loading">Loading description…</div>
        ) : detail?.body ? (
          <GithubMarkdown ctx={ctx}>{detail.body}</GithubMarkdown>
        ) : (
          <p className="ghpr-detail__body ghpr-detail__body--empty">No description.</p>
        )}
      </section>

      <section className="ghpr-detail__section">
        <h3 className="ghpr-detail__section-title">Activity</h3>
        {showDetailError ? (
          <div className="ghpr-detail__loading">Couldn’t load activity.</div>
        ) : loadingDetail && timeline.length === 0 ? (
          <div className="ghpr-detail__loading">Loading activity…</div>
        ) : timeline.length === 0 ? (
          <div className="ghpr-detail__loading">No recent comments.</div>
        ) : (
          timeline.map((item) => (
            <div key={item.key} className="ghpr-timeline-row">
              <div className="ghpr-timeline-row__content">
                <div>
                  <span className="ghpr-timeline-row__who">{item.who}</span>
                  {" "}
                  <span className="ghpr-timeline-row__when">{item.kindLabel}</span>
                  {item.when && (
                    <span className="ghpr-timeline-row__when">
                      {" · "}
                      {formatElapsed(item.when)}
                    </span>
                  )}
                </div>
                {item.body && <p className="ghpr-timeline-row__body">{item.body}</p>}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
