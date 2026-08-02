import type { ExtensionContext } from "@silo-code/sdk";
import type { PrReview, PrReviewComment } from "../github-pr-api";
import { reviewKindLabel } from "../detail-helpers";
import { formatElapsed } from "../format-elapsed";
import { reviewStateIcon } from "./PrDetailView";
import { GithubMarkdown } from "./GithubMarkdown";

export interface PrReviewViewProps {
  ctx: ExtensionContext;
  review: PrReview | undefined;
  /** File/line-scoped inline comments — often where a "COMMENTED" review's
   * actual feedback lives when `review.body` (the summary) is empty. */
  comments: PrReviewComment[];
  loadingComments: boolean;
  commentsError: string | null;
}

/** One review's full body plus its inline (file/line-scoped) comments —
 * pushed from a review row on the detail page. `review` itself comes
 * straight out of the already-cached PrDetail.reviews (no fetch needed, the
 * detail page already had to load it to render the row that got clicked);
 * `comments` is fetched separately (see PrService.fetchReviewComments) since
 * it needs its own REST round trip. */
export function PrReviewView({
  ctx,
  review,
  comments,
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
  const showEmptyState = !hasBody && comments.length === 0 && !loadingComments && !commentsError;

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
      {!hasBody && loadingComments && comments.length === 0 && (
        <div className="ghpr-detail__section">
          <div className="ghpr-detail__loading">Loading comment…</div>
        </div>
      )}
      {commentsError && comments.length === 0 && (
        <div className="ghpr-error-banner ghpr-error-banner--inline">{commentsError}</div>
      )}
      {comments.length > 0 && (
        <div className="ghpr-review-comments">
          {comments.map((c) => (
            <div key={c.id} className="ghpr-review-comment">
              <div className="ghpr-review-comment__path">
                {c.path}
                {c.line != null ? `:${c.line}` : ""}
              </div>
              <GithubMarkdown ctx={ctx}>{c.body}</GithubMarkdown>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
