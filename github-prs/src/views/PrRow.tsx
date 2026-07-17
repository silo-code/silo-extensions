import type { HTMLAttributes, ReactNode } from "react";
import {
  CheckCircle,
  CircleNotch,
  ClockCountdown,
  GitMerge,
  GitPullRequest,
  XCircle,
} from "@phosphor-icons/react";
import { Tooltip } from "@silo-code/sdk";
import type { PrListItem } from "../github-pr-api";
import {
  REVIEW_STATE_LABELS,
  checkSummaryLabel,
  deriveReviewState,
  hasConflicts,
  summarizeChecks,
  type ReviewState,
} from "../status";
import { formatElapsed } from "../format-elapsed";

export interface PrRowProps {
  pr: PrListItem;
  onOpen: () => void;
  focusProps?: HTMLAttributes<HTMLElement>;
}

function reviewIcon(state: ReviewState) {
  switch (state) {
    case "approved":
      return <CheckCircle size={16} weight="fill" className="ghpr-row__icon ghpr-row__icon--ok" />;
    case "changes-requested":
      return <XCircle size={16} weight="fill" className="ghpr-row__icon ghpr-row__icon--err" />;
    case "review-required":
      return <ClockCountdown size={16} weight="fill" className="ghpr-row__icon ghpr-row__icon--warn" />;
    case "merged":
      return <GitMerge size={16} weight="fill" className="ghpr-row__icon ghpr-row__icon--accent" />;
    case "draft":
      return <GitPullRequest size={16} weight="duotone" className="ghpr-row__icon ghpr-row__icon--muted" />;
    case "closed":
      return <XCircle size={16} weight="regular" className="ghpr-row__icon ghpr-row__icon--muted" />;
    default:
      return <GitPullRequest size={16} weight="fill" className="ghpr-row__icon ghpr-row__icon--accent" />;
  }
}

export function PrRow({ pr, onOpen, focusProps }: PrRowProps) {
  const review = deriveReviewState(pr);
  const checks = summarizeChecks(pr.statusCheckRollup);
  const conflicts = hasConflicts(pr);
  const labels = pr.labels.slice(0, 2);
  const extraLabels = pr.labels.length - labels.length;

  let trail: ReactNode = null;
  if (checks.overall === "failing") {
    trail = (
      <Tooltip content={checkSummaryLabel(checks)}>
        <span className="ghpr-row__trail ghpr-row__trail--err">
          <XCircle size={14} weight="fill" />
          {checks.failing > 1 ? checks.failing : null}
        </span>
      </Tooltip>
    );
  } else if (checks.overall === "pending") {
    trail = (
      <Tooltip content={checkSummaryLabel(checks)}>
        <span className="ghpr-row__trail ghpr-row__trail--warn">
          <CircleNotch size={14} weight="bold" className="ghpr-pulse" />
        </span>
      </Tooltip>
    );
  } else if (checks.overall === "passing") {
    trail = (
      <Tooltip content={checkSummaryLabel(checks)}>
        <span className="ghpr-row__trail ghpr-row__trail--ok">
          <CheckCircle size={14} weight="fill" />
        </span>
      </Tooltip>
    );
  }

  const updated = pr.updatedAt ? formatElapsed(new Date(pr.updatedAt)) : null;

  return (
    <button
      type="button"
      className="ghpr-row"
      onClick={onOpen}
      title={REVIEW_STATE_LABELS[review]}
      {...focusProps}
    >
      {reviewIcon(review)}
      <div className="ghpr-row__main">
        <div className="ghpr-row__title">{pr.title}</div>
        <div className="ghpr-row__meta">
          <span className="ghpr-row__num">#{pr.number}</span>
          {pr.author?.login && <span>{pr.author.login}</span>}
          {review === "draft" && <span className="ghpr-chip ghpr-chip--muted">Draft</span>}
          {conflicts && <span className="ghpr-chip ghpr-chip--err">Conflicts</span>}
          {labels.map((l) => (
            <span key={l.name} className="ghpr-chip">{l.name}</span>
          ))}
          {extraLabels > 0 && <span className="ghpr-chip">+{extraLabels}</span>}
          {updated && <span>{updated}</span>}
        </div>
      </div>
      {trail}
    </button>
  );
}
