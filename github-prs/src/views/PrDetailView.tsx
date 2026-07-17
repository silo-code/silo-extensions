import { useMemo } from "react";
import {
  CheckCircle,
  CircleNotch,
  ClockCountdown,
  XCircle,
} from "@phosphor-icons/react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ExtensionContext } from "@silo-code/sdk";
import type { CheckContext, PrDetail, PrListItem, PrReview } from "../github-pr-api";
import {
  REVIEW_STATE_LABELS,
  checkName,
  checkUrl,
  classifyCheck,
  deriveReviewState,
  hasConflicts,
  type CheckOutcome,
} from "../status";
import { formatElapsed } from "../format-elapsed";
import type { DetailCacheEntry } from "../store";

export interface PrDetailViewProps {
  ctx: ExtensionContext;
  pr: PrListItem;
  detailEntry: DetailCacheEntry | undefined;
  loadingDetail: boolean;
}

interface TimelineItem {
  key: string;
  who: string;
  when: Date | null;
  kind: string;
  body: string;
  url?: string;
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

function reviewStateIcon(state: string) {
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

function buildTimeline(detail: PrDetail): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const c of detail.comments) {
    items.push({
      key: `c:${c.createdAt}:${c.author?.login ?? ""}`,
      who: c.author?.login ?? "unknown",
      when: c.createdAt ? new Date(c.createdAt) : null,
      kind: "commented",
      body: c.body,
      url: c.url || undefined,
    });
  }
  for (const r of detail.reviews) {
    if (!r.body && r.state === "COMMENTED") continue;
    items.push({
      key: `r:${r.submittedAt ?? ""}:${r.author?.login ?? ""}:${r.state}`,
      who: r.author?.login ?? "unknown",
      when: r.submittedAt ? new Date(r.submittedAt) : null,
      kind: r.state.toLowerCase().replace(/_/g, " "),
      body: r.body,
    });
  }
  return items.sort((a, b) => {
    const at = a.when?.getTime() ?? 0;
    const bt = b.when?.getTime() ?? 0;
    return bt - at;
  });
}

function uniqueReviewers(pr: PrListItem, detail?: PrDetail): PrReview[] {
  const reviews = detail?.reviews?.length ? detail.reviews : pr.latestReviews;
  const byLogin = new Map<string, PrReview>();
  for (const r of reviews) {
    const login = r.author?.login;
    if (!login) continue;
    const prev = byLogin.get(login);
    if (!prev || (r.submittedAt && (!prev.submittedAt || r.submittedAt > prev.submittedAt))) {
      byLogin.set(login, r);
    }
  }
  return [...byLogin.values()];
}

export function PrDetailView({ ctx, pr, detailEntry, loadingDetail }: PrDetailViewProps) {
  const detail = detailEntry?.detail;
  const review = deriveReviewState(pr);
  const checks = pr.statusCheckRollup;
  const reviewers = useMemo(() => uniqueReviewers(pr, detail), [pr, detail]);
  const timeline = useMemo(() => (detail ? buildTimeline(detail) : []), [detail]);
  const requested = pr.reviewRequests
    .map((r) => r.login ?? r.name)
    .filter((x): x is string => !!x);

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
            {detail?.changedFiles != null && detail.changedFiles > 0 && (
              <> · {detail.changedFiles} files</>
            )}
          </span>
        </div>
      </section>

      <section className="ghpr-detail__section">
        <h3 className="ghpr-detail__section-title">Checks</h3>
        {checks.length === 0 ? (
          <div className="ghpr-detail__loading">No checks reported.</div>
        ) : (
          checks.map((check: CheckContext, i) => {
            const outcome = classifyCheck(check);
            const url = checkUrl(check);
            const name = checkName(check);
            const workflow =
              check.__typename === "CheckRun" && check.workflowName
                ? check.workflowName
                : null;
            return (
              <button
                key={`${name}:${i}`}
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
          })
        )}
      </section>

      <section className="ghpr-detail__section">
        <h3 className="ghpr-detail__section-title">Reviews</h3>
        {reviewers.length === 0 && requested.length === 0 ? (
          <div className="ghpr-detail__loading">No reviewers yet.</div>
        ) : (
          <>
            {reviewers.map((r) => (
              <div key={r.author?.login ?? r.submittedAt} className="ghpr-review-row">
                {reviewStateIcon(r.state)}
                <span>
                  <span className="ghpr-timeline-row__who">{r.author?.login ?? "unknown"}</span>
                  {" · "}
                  {r.state.toLowerCase().replace(/_/g, " ")}
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
        {loadingDetail && !detail ? (
          <div className="ghpr-detail__loading">Loading description…</div>
        ) : detail?.body ? (
          <div className="ghpr-md">
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children }) => (
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      if (href) void ctx.ui.openExternal(href);
                    }}
                  >
                    {children}
                  </a>
                ),
                img: ({ src, alt }) =>
                  typeof src === "string" && /^https?:\/\//.test(src) ? (
                    <img src={src} alt={alt ?? ""} />
                  ) : null,
              }}
            >
              {detail.body}
            </Markdown>
          </div>
        ) : (
          <p className="ghpr-detail__body ghpr-detail__body--empty">No description.</p>
        )}
      </section>

      <section className="ghpr-detail__section">
        <h3 className="ghpr-detail__section-title">Activity</h3>
        {loadingDetail && timeline.length === 0 ? (
          <div className="ghpr-detail__loading">Loading activity…</div>
        ) : timeline.length === 0 ? (
          <div className="ghpr-detail__loading">No recent comments.</div>
        ) : (
          timeline.map((item) => (
            <div key={item.key} className="ghpr-timeline-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div>
                  <span className="ghpr-timeline-row__who">{item.who}</span>
                  {" "}
                  <span className="ghpr-timeline-row__when">{item.kind}</span>
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
