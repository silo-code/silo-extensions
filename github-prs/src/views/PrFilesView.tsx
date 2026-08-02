import { File as FileIcon } from "@phosphor-icons/react";
import { Tooltip, type ExtensionContext } from "@silo-code/sdk";
import type { PrFileChange } from "../github-pr-api";

export interface PrFilesViewProps {
  ctx: ExtensionContext;
  owner: string;
  repo: string;
  /** Workspace-scoped cwd `gh` runs from for this repo; `null` when no open
   * workspace currently resolves to it (diff rows are hidden in that case —
   * there's nowhere to run `gh` from). */
  cwd: string | null;
  files: PrFileChange[];
  /** Merge-base / head shas from PrService.fetchFiles — the diff provider's
   * two sides. `null` until the fetch resolves. */
  baseSha: string | null;
  headSha: string | null;
  loading: boolean;
  error: string | null;
}

function statFor(f: PrFileChange) {
  if ((f.additions ?? 0) === 0 && (f.deletions ?? 0) === 0) return null;
  return (
    <span className="ghpr-file-stat">
      <span className="ghpr-detail__add">+{f.additions}</span>{" "}
      <span className="ghpr-detail__del">−{f.deletions}</span>
    </span>
  );
}

/** The PR's overall changed files — pushed from PrDetailView's "N files"
 * link. Unlike PrCommitView (one commit vs its own first parent), each file
 * here diffs against the PR's merge-base (PrService.fetchFiles resolves it),
 * so the list matches what GitHub's own "Files changed" tab shows — not
 * every commit landed on the base branch since the PR forked. */
export function PrFilesView({
  ctx,
  owner,
  repo,
  cwd,
  files,
  baseSha,
  headSha,
  loading,
  error,
}: PrFilesViewProps) {
  if (error && files.length === 0) {
    return (
      <div className="ghpr-empty">
        <div className="ghpr-empty__title">Couldn’t load files</div>
        <div>{error}</div>
      </div>
    );
  }
  if (loading && files.length === 0) {
    return (
      <div className="ghpr-empty">
        <div className="ghpr-empty__title">Loading files…</div>
      </div>
    );
  }
  if (files.length === 0) {
    return (
      <div className="ghpr-empty">
        <div className="ghpr-empty__title">No files changed</div>
      </div>
    );
  }

  const totals = files.reduce(
    (acc, f) => ({
      additions: acc.additions + (f.additions ?? 0),
      deletions: acc.deletions + (f.deletions ?? 0),
    }),
    { additions: 0, deletions: 0 },
  );

  function openDiff(file: PrFileChange) {
    if (!cwd || !headSha) return;
    const base = file.path.split("/").pop() ?? file.path;
    ctx.editors.openDiff(
      {
        filePath: `${owner}/${repo}/${file.path}`,
        providerId: "silo.github-prs",
        args: {
          owner,
          repo,
          cwd,
          commit: headSha,
          parent: baseSha ?? undefined,
          path: file.path,
          origPath: file.origPath,
        },
        title: base,
      },
      { preview: true },
    );
  }

  return (
    <div className="ghpr-commit-detail">
      <div className="ghpr-commit-detail-stats">
        {files.length} file{files.length === 1 ? "" : "s"} changed
        {(totals.additions > 0 || totals.deletions > 0) && (
          <>
            {" · "}
            <span className="ghpr-detail__add">+{totals.additions}</span>{" "}
            <span className="ghpr-detail__del">−{totals.deletions}</span>
          </>
        )}
      </div>
      <div className="ghpr-commit-detail-files">
        {files.map((f) => (
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
