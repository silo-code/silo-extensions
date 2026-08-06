import type { ExtensionContext } from "@silo-code/sdk";
import type { GitHubApiError, PrCommitListItem } from "../github-pr-api";
import { formatElapsed } from "../format-elapsed";
import { showErrorDetail } from "./error-detail";

export interface PrCommitsViewProps {
  ctx: ExtensionContext;
  commits: PrCommitListItem[];
  loading: boolean;
  error: GitHubApiError | null;
  onSelectCommit: (sha: string) => void;
}

/** The PR's own commit list — pushed from PrDetailView, one level short of a
 * commit's changed files. Commits ride along with `PrDetail.commits` (a free
 * field on the already-fetched PR detail), so this is purely presentational —
 * `loading`/`error` mirror the detail page's own fetch state. */
export function PrCommitsView({ ctx, commits, loading, error, onSelectCommit }: PrCommitsViewProps) {
  if (error && commits.length === 0) {
    return (
      <div className="ghpr-empty">
        <div className="ghpr-empty__title">Couldn’t load commits</div>
        <div>{error.message}</div>
        <button type="button" className="ghpr-link" onClick={() => showErrorDetail(ctx, error)}>
          Details
        </button>
      </div>
    );
  }
  if (loading && commits.length === 0) {
    return (
      <div className="ghpr-empty">
        <div className="ghpr-empty__title">Loading commits…</div>
      </div>
    );
  }
  if (commits.length === 0) {
    return (
      <div className="ghpr-empty">
        <div className="ghpr-empty__title">No commits</div>
      </div>
    );
  }
  return (
    <div className="ghpr-commits-list">
      {commits.map((c) => (
        <div
          key={c.sha}
          className="ghpr-commit-row"
          role="button"
          tabIndex={0}
          onClick={() => onSelectCommit(c.sha)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelectCommit(c.sha);
            }
          }}
        >
          <div className="ghpr-commit-subject" title={c.subject}>
            {c.subject}
          </div>
          <div className="ghpr-commit-meta">
            <span>{c.authorLogin ?? (c.authorName || "unknown")}</span>
            {c.date && <span>{formatElapsed(new Date(c.date))}</span>}
            <code className="ghpr-commit-shortsha">{c.shortSha}</code>
          </div>
        </div>
      ))}
    </div>
  );
}
