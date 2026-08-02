import type { ExtensionContext } from "@silo-code/sdk";
import type { PrReview } from "../github-pr-api";
import { reviewKindLabel } from "../detail-helpers";
import { formatElapsed } from "../format-elapsed";
import { reviewStateIcon } from "./PrDetailView";
import { GithubMarkdown } from "./GithubMarkdown";

export interface PrReviewViewProps {
  ctx: ExtensionContext;
  review: PrReview | undefined;
}

/** One review's full body — pushed from a review row on the detail page.
 * Unlike Commits/Files, this needs no fetch or loading state: `review`
 * comes straight out of the already-cached PrDetail.reviews (the detail
 * page already had to load it to render the row that got clicked). */
export function PrReviewView({ ctx, review }: PrReviewViewProps) {
  if (!review) {
    return (
      <div className="ghpr-empty">
        <div className="ghpr-empty__title">Review not found.</div>
      </div>
    );
  }

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
      <div className="ghpr-detail__section">
        {review.body ? (
          <GithubMarkdown ctx={ctx}>{review.body}</GithubMarkdown>
        ) : (
          <p className="ghpr-detail__body ghpr-detail__body--empty">No comment.</p>
        )}
      </div>
    </div>
  );
}
