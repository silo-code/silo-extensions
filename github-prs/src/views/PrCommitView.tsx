import type { ReactNode } from "react";
import { File as FileIcon } from "@phosphor-icons/react";
import { Tooltip, type ExtensionContext } from "@silo-code/sdk";
import type { GitHubApiError, PrCommitDetail, PrFileChange } from "../github-pr-api";
import { formatElapsed } from "../format-elapsed";
import { showErrorDetail } from "./error-detail";

export interface PrCommitViewProps {
  ctx: ExtensionContext;
  owner: string;
  repo: string;
  /** Workspace-scoped cwd `gh` runs from for this repo; `null` when no open
   * workspace currently resolves to it (diff rows are hidden in that case —
   * there's nowhere to run `gh` from). */
  cwd: string | null;
  detail: PrCommitDetail | undefined;
  loading: boolean;
  error: GitHubApiError | null;
}

function statFor(f: PrFileChange): ReactNode {
  if ((f.additions ?? 0) === 0 && (f.deletions ?? 0) === 0) return null;
  return (
    <span className="ghpr-file-stat">
      <span className="ghpr-detail__add">+{f.additions}</span>{" "}
      <span className="ghpr-detail__del">−{f.deletions}</span>
    </span>
  );
}

/** A single commit's message and changed files — pushed from PrCommitsView.
 * Row click opens the file's diff (base = the commit's first parent) via the
 * `silo.github-prs` content provider, the same generic diff editor Silo's
 * git-explorer uses, just resolving both sides from the GitHub Contents API
 * instead of a local git object store — the commit's own sha may never have
 * been fetched into the workspace's clone (e.g. a fork PR's head). */
export function PrCommitView({ ctx, owner, repo, cwd, detail, loading, error }: PrCommitViewProps) {
  if (error && !detail) {
    return (
      <div className="ghpr-empty">
        <div className="ghpr-empty__title">Couldn’t load commit</div>
        <div>{error.message}</div>
        <button type="button" className="ghpr-link" onClick={() => showErrorDetail(ctx, error)}>
          Details
        </button>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="ghpr-empty">
        <div className="ghpr-empty__title">{loading ? "Loading commit…" : "Commit not found."}</div>
      </div>
    );
  }

  const totals = detail.files.reduce(
    (acc, f) => ({
      additions: acc.additions + (f.additions ?? 0),
      deletions: acc.deletions + (f.deletions ?? 0),
    }),
    { additions: 0, deletions: 0 },
  );

  function openDiff(file: PrFileChange) {
    if (!cwd || !detail) return;
    const base = file.path.split("/").pop() ?? file.path;
    ctx.editors.openDiff(
      {
        filePath: `${owner}/${repo}/${file.path}`,
        providerId: "silo.github-prs",
        args: {
          owner,
          repo,
          cwd,
          commit: detail.sha,
          parent: detail.parentSha ?? undefined,
          path: file.path,
          origPath: file.origPath,
        },
        title: `${base} (${detail.shortSha})`,
      },
      { preview: true },
    );
  }

  return (
    <div className="ghpr-commit-detail">
      <div className="ghpr-commit-detail-message">
        <div className="ghpr-commit-detail-subject">{detail.subject}</div>
        {detail.body && <pre className="ghpr-commit-detail-body">{detail.body}</pre>}
        <div className="ghpr-commit-detail-meta">
          <span>{detail.authorLogin ?? (detail.authorName || "unknown")}</span>
          {detail.date && <span>{formatElapsed(new Date(detail.date))}</span>}
          <code>{detail.shortSha}</code>
        </div>
      </div>
      <div className="ghpr-commit-detail-stats">
        {detail.files.length} file{detail.files.length === 1 ? "" : "s"} changed
        {(totals.additions > 0 || totals.deletions > 0) && (
          <>
            {" · "}
            <span className="ghpr-detail__add">+{totals.additions}</span>{" "}
            <span className="ghpr-detail__del">−{totals.deletions}</span>
          </>
        )}
      </div>
      <div className="ghpr-commit-detail-files">
        {detail.files.map((f) => (
          <div
            key={f.path}
            className="ghpr-file-row"
            role="button"
            tabIndex={0}
            onClick={() => openDiff(f)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openDiff(f);
              }
            }}
          >
            <span className="ico file">
              <FileIcon size="1.3em" weight="regular" aria-hidden="true" />
            </span>
            <Tooltip content={f.path}>
              <span className="ghpr-file-name">{f.path.split("/").pop()}</span>
            </Tooltip>
            {f.origPath && (
              <span className="ghpr-file-dir" title={`renamed from ${f.origPath}`}>
                ← {f.origPath}
              </span>
            )}
            {statFor(f)}
            <span className={`ghpr-status-glyph ghpr-status-${f.status}`}>{f.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
