import type { ExtensionContext } from "@silo-code/sdk";
import type { GitHubApiError, PrReview, PrReviewThread } from "../github-pr-api";
import { reviewKindLabel } from "../detail-helpers";
import { formatElapsed } from "../format-elapsed";
import { ErrorBanner } from "./ErrorBanner";
import { reviewStateIcon } from "./PrDetailView";
import { GithubMarkdown } from "./GithubMarkdown";

export interface PrReviewViewProps {
  ctx: ExtensionContext;
  review: PrReview | undefined;
  /** Full inline (file/line-scoped) conversations this review participated
   * in — often where a "COMMENTED" review's actual feedback lives when
   * `review.body` (the summary) is empty. */
  threads: PrReviewThread[];
  loadingComments: boolean;
  commentsError: GitHubApiError | null;
}

/** One review's full body plus every inline (file/line-scoped) conversation
 * it participated in — pushed from a review row on the detail page.
 * `review` itself comes straight out of the already-cached PrDetail.reviews
 * (no fetch needed, the detail page already had to load it to render the
 * row that got clicked); `threads` is fetched separately (see
 * PrService.fetchReviewComments) since it needs its own REST round trip. */
export function PrReviewView({
  ctx,
  review,
  threads,
  loadingComments,
  commentsError,
}: PrReviewViewProps) {
  if (!review) {
    return (
      <div className="ghpr-empty">
        <div className="ghpr-empty__title">Review not found.</div>
      </div>
    );
  }

  const hasBody = !!review.body;
  const showEmptyState = !hasBody && threads.length === 0 && !loadingComments && !commentsError;

  return (
    <div className="ghpr-commit-detail">
      <div className="ghpr-commit-detail-message">
        <div className="ghpr-commit-detail-meta">
          {reviewStateIcon(review.state)}
          <span>{review.author?.login ?? "unknown"}</span>
          <span>{reviewKindLabel(review.state)}</span>
          {review.submittedAt && <span>{formatElapsed(new Date(review.submittedAt))}</span>}
        </div>
      </div>
      {hasBody && (
        <div className="ghpr-detail__section">
          <GithubMarkdown ctx={ctx}>{review.body}</GithubMarkdown>
        </div>
      )}
      {showEmptyState && (
        <div className="ghpr-detail__section">
          <p className="ghpr-detail__body ghpr-detail__body--empty">No comment.</p>
        </div>
      )}
      {!hasBody && loadingComments && threads.length === 0 && (
        <div className="ghpr-detail__section">
          <div className="ghpr-detail__loading">Loading comment…</div>
        </div>
      )}
      {commentsError && threads.length === 0 && (
        <ErrorBanner ctx={ctx} error={commentsError} inline />
      )}
      {threads.length > 0 && (
        <div className="ghpr-review-comments">
          {threads.map((thread) => (
            <div key={`${thread.path}:${thread.line ?? "?"}:${thread.comments[0]?.id}`} className="ghpr-review-thread">
              <div className="ghpr-review-thread__path">
                {thread.path}
                {thread.line != null ? `:${thread.line}` : ""}
              </div>
              {thread.comments.map((c) => (
                <div key={c.id} className="ghpr-review-thread__message">
                  <div className="ghpr-review-thread__message-meta">
                    <strong>{c.authorLogin ?? "unknown"}</strong>
                    {c.createdAt && <> · {formatElapsed(new Date(c.createdAt))}</>}
                  </div>
                  <GithubMarkdown ctx={ctx}>{c.body}</GithubMarkdown>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
