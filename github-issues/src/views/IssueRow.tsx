import type { HTMLAttributes } from "react";
import { Circle, CheckCircle, XCircle } from "@phosphor-icons/react";
import { Tooltip } from "@silo-code/sdk";
import type { IssueListItem } from "../github-issue-api";
import { deriveIssueState, STATE_LABELS, type IssueState } from "../status";
import { formatElapsed } from "../format-elapsed";
import { labelTextColor } from "../detail-helpers";

export interface IssueRowProps {
  issue: IssueListItem;
  onOpen: () => void;
  focusProps?: HTMLAttributes<HTMLElement>;
}

function stateIcon(state: IssueState) {
  switch (state) {
    case "open":
      return <Circle size={16} weight="fill" className="ghi-row__icon ghi-row__icon--ok" />;
    case "closed-completed":
      return <CheckCircle size={16} weight="fill" className="ghi-row__icon ghi-row__icon--accent" />;
    case "closed-not-planned":
      return <XCircle size={16} weight="regular" className="ghi-row__icon ghi-row__icon--muted" />;
  }
}

export function IssueRow({ issue, onOpen, focusProps }: IssueRowProps) {
  const state = deriveIssueState(issue);
  const labels = issue.labels.slice(0, 2);
  const extraLabels = issue.labels.length - labels.length;
  const assignees = issue.assignees.map((a) => a.login);
  const updated = issue.updatedAt ? formatElapsed(new Date(issue.updatedAt)) : null;

  return (
    <button
      type="button"
      className="ghi-row"
      onClick={onOpen}
      title={STATE_LABELS[state]}
      {...focusProps}
    >
      {stateIcon(state)}
      <div className="ghi-row__main">
        <div className="ghi-row__title">{issue.title}</div>
        <div className="ghi-row__meta">
          <span className="ghi-row__num">#{issue.number}</span>
          {issue.author?.login && <span>{issue.author.login}</span>}
          {labels.map((l) => (
            <span
              key={l.name}
              className="ghi-chip ghi-chip--label"
              style={{ backgroundColor: `#${l.color}`, color: labelTextColor(l.color) }}
            >
              {l.name}
            </span>
          ))}
          {extraLabels > 0 && <span className="ghi-chip">+{extraLabels}</span>}
          {assignees.length > 0 && (
            <Tooltip content={`Assigned: ${assignees.join(", ")}`}>
              <span className="ghi-chip ghi-chip--muted">
                {assignees[0]}
                {assignees.length > 1 ? ` +${assignees.length - 1}` : ""}
              </span>
            </Tooltip>
          )}
          {updated && <span>{updated}</span>}
        </div>
      </div>
    </button>
  );
}
