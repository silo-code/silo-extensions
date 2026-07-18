// Merge methods GitHub may allow on a repository. Values match `gh pr merge` flags.
export type MergeMethod = "squash" | "merge" | "rebase";

export const MERGE_METHOD_LABELS: Record<MergeMethod, string> = {
  squash: "Squash and merge",
  merge: "Create a merge commit",
  rebase: "Rebase and merge",
};

// Preference order when presenting a multi-method menu (squash first).
export const MERGE_METHOD_ORDER: MergeMethod[] = ["squash", "merge", "rebase"];

export interface RepoMergeMethods {
  squash: boolean;
  merge: boolean;
  rebase: boolean;
}

export function allowedMergeMethods(repo: RepoMergeMethods): MergeMethod[] {
  return MERGE_METHOD_ORDER.filter((m) => repo[m]);
}

// Confirm-dialog copy naming the PR and chosen method.
export function mergeConfirmCopy(
  pr: { number: number; title: string; baseRefName: string },
  method: MergeMethod,
): { title: string; body: string; confirmLabel: string } {
  return {
    title: `Merge #${pr.number}?`,
    body: `${MERGE_METHOD_LABELS[method]} “${pr.title}” into ${pr.baseRefName}.`,
    confirmLabel: "Merge",
  };
}
