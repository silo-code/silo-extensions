import type { IssueDetail, IssueListItem } from "./github-issue-api";

export interface TimelineItem {
  key: string;
  who: string;
  when: Date | null;
  body: string;
  url?: string;
}

export function buildTimeline(detail: IssueDetail): TimelineItem[] {
  const items: TimelineItem[] = detail.comments.map((c) => ({
    key: `c:${c.createdAt}:${c.author?.login ?? ""}`,
    who: c.author?.login ?? "unknown",
    when: c.createdAt ? new Date(c.createdAt) : null,
    body: c.body,
    url: c.url || undefined,
  }));
  return items.sort((a, b) => {
    const at = a.when?.getTime() ?? 0;
    const bt = b.when?.getTime() ?? 0;
    return bt - at;
  });
}

export function findIssueInRepoStates(
  repoStates: Array<{ repoInfo: { owner: string; repo: string } | null; openIssues: IssueListItem[]; closedIssues: IssueListItem[] }>,
  repoKey: string,
  number: number,
): IssueListItem | null {
  for (const state of repoStates) {
    if (!state.repoInfo) continue;
    if (`${state.repoInfo.owner}/${state.repoInfo.repo}` !== repoKey) continue;
    const found = [...state.openIssues, ...state.closedIssues].find((i) => i.number === number);
    if (found) return found;
  }
  return null;
}

export function folderRootName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

const HEX_RE = /^#?([0-9a-fA-F]{6})$/;

// Picks black or white text for a GitHub label chip given its background hex
// color, via the standard YIQ perceptual-brightness split — the same
// threshold GitHub's own label rendering uses.
export function labelTextColor(hex: string): "#000000" | "#ffffff" {
  const match = HEX_RE.exec(hex);
  if (!match) return "#000000";
  const clean = match[1];
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? "#000000" : "#ffffff";
}
