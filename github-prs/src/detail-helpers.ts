import type { PrDetail, PrListItem, PrReview } from "./github-pr-api";

export interface TimelineItem {
  key: string;
  who: string;
  when: Date | null;
  kind: string;
  kindLabel: string;
  body: string;
  url?: string;
}

const REVIEW_KIND_LABELS: Record<string, string> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "requested changes",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
  PENDING: "pending",
};

export function reviewKindLabel(state: string): string {
  return REVIEW_KIND_LABELS[state] ?? state.toLowerCase().replace(/_/g, " ");
}

export function buildTimeline(detail: PrDetail): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const c of detail.comments) {
    items.push({
      key: `c:${c.createdAt}:${c.author?.login ?? ""}`,
      who: c.author?.login ?? "unknown",
      when: c.createdAt ? new Date(c.createdAt) : null,
      kind: "commented",
      kindLabel: "commented",
      body: c.body,
      url: c.url || undefined,
    });
  }
  for (const r of detail.reviews) {
    if (!r.body && r.state === "COMMENTED") continue;
    items.push({
      key: `r:${r.submittedAt ?? ""}:${r.author?.login ?? ""}:${r.state}`,
      who: r.author?.login ?? "unknown",
      when: r.submittedAt ? new Date(r.submittedAt) : null,
      kind: r.state,
      kindLabel: reviewKindLabel(r.state),
      body: r.body,
    });
  }
  return items.sort((a, b) => {
    const at = a.when?.getTime() ?? 0;
    const bt = b.when?.getTime() ?? 0;
    return bt - at;
  });
}

export function uniqueReviewers(pr: PrListItem, detail?: PrDetail): PrReview[] {
  const reviews = detail?.reviews?.length ? detail.reviews : pr.latestReviews;
  const byLogin = new Map<string, PrReview>();
  for (const r of reviews) {
    const login = r.author?.login;
    if (!login) continue;
    const prev = byLogin.get(login);
    if (!prev || (r.submittedAt && (!prev.submittedAt || r.submittedAt > prev.submittedAt))) {
      byLogin.set(login, r);
    }
  }
  return [...byLogin.values()];
}

export function findPrInRepoStates(
  repoStates: Array<{ folder: string; openPrs: PrListItem[]; mergedPrs: PrListItem[] }>,
  folder: string,
  number: number,
): PrListItem | null {
  for (const state of repoStates) {
    if (state.folder !== folder) continue;
    const found = [...state.openPrs, ...state.mergedPrs].find((p) => p.number === number);
    if (found) return found;
  }
  return null;
}

export function folderRootName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

export function checkKey(check: { __typename: string; name?: string; context?: string; detailsUrl?: string; targetUrl?: string }): string {
  const name = check.__typename === "CheckRun" ? (check.name ?? "") : (check.context ?? "");
  const url = check.__typename === "CheckRun" ? (check.detailsUrl ?? "") : (check.targetUrl ?? "");
  return `${check.__typename}:${name}:${url}`;
}
