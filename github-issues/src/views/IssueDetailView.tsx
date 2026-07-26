import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ExtensionContext } from "@silo-code/sdk";
import type { IssueListItem } from "../github-issue-api";
import { deriveIssueState, STATE_LABELS } from "../status";
import { formatElapsed } from "../format-elapsed";
import { buildTimeline, labelTextColor } from "../detail-helpers";
import type { DetailCacheEntry, DetailErrorEntry } from "../store";

export interface IssueDetailViewProps {
  ctx: ExtensionContext;
  issue: IssueListItem;
  detailEntry: DetailCacheEntry | undefined;
  detailError: DetailErrorEntry | undefined;
  loadingDetail: boolean;
}

export function IssueDetailView({
  ctx,
  issue,
  detailEntry,
  detailError,
  loadingDetail,
}: IssueDetailViewProps) {
  const detail = detailEntry?.detail;
  const state = deriveIssueState(issue);
  const timeline = detail ? buildTimeline(detail) : [];
  const showDetailError = !!detailError && !detail;

  return (
    <div className="ghi-detail">
      <section className="ghi-detail__section">
        <div className="ghi-detail__meta">
          <span>
            <strong>{STATE_LABELS[state]}</strong>
          </span>
          {issue.author?.login && <span>by {issue.author.login}</span>}
          {issue.milestone && (
            <span className="ghi-chip ghi-chip--muted">{issue.milestone.title}</span>
          )}
        </div>
        {(issue.labels.length > 0 || issue.assignees.length > 0) && (
          <div className="ghi-detail__meta">
            {issue.labels.map((l) => (
              <span
                key={l.name}
                className="ghi-chip ghi-chip--label"
                style={{ backgroundColor: `#${l.color}`, color: labelTextColor(l.color) }}
              >
                {l.name}
              </span>
            ))}
            {issue.assignees.map((a) => (
              <span key={a.login} className="ghi-chip ghi-chip--muted">
                {a.login}
              </span>
            ))}
          </div>
        )}
      </section>

      {showDetailError && (
        <div className="ghi-error-banner">{detailError.error.message}</div>
      )}

      <section className="ghi-detail__section">
        <h3 className="ghi-detail__section-title">Description</h3>
        {showDetailError ? (
          <div className="ghi-detail__loading">Couldn’t load description.</div>
        ) : loadingDetail && !detail ? (
          <div className="ghi-detail__loading">Loading description…</div>
        ) : detail?.body ? (
          <div className="ghi-md">
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
          <p className="ghi-detail__body ghi-detail__body--empty">No description.</p>
        )}
      </section>

      <section className="ghi-detail__section">
        <h3 className="ghi-detail__section-title">Activity</h3>
        {showDetailError ? (
          <div className="ghi-detail__loading">Couldn’t load activity.</div>
        ) : loadingDetail && timeline.length === 0 ? (
          <div className="ghi-detail__loading">Loading activity…</div>
        ) : timeline.length === 0 ? (
          <div className="ghi-detail__loading">No comments yet.</div>
        ) : (
          timeline.map((item) => (
            <div key={item.key} className="ghi-timeline-row">
              <div className="ghi-timeline-row__content">
                <div>
                  <span className="ghi-timeline-row__who">{item.who}</span>
                  {" "}
                  <span className="ghi-timeline-row__when">commented</span>
                  {item.when && (
                    <span className="ghi-timeline-row__when">
                      {" · "}
                      {formatElapsed(item.when)}
                    </span>
                  )}
                </div>
                {item.body && <p className="ghi-timeline-row__body">{item.body}</p>}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
