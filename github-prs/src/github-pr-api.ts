import type { ExtensionContext } from "@silo-code/sdk";
import type { MergeMethod, RepoMergeMethods } from "./merge-methods";

export type { MergeMethod };

// Ceilings on how many PRs a single fetch returns. GitHub returns newest-first,
// so these bound how far back the panel looks.
const OPEN_PRS_LIMIT = 50;
const MERGED_PRS_LIMIT = 20;

// macOS app bundles don't inherit the user's shell PATH, so `gh` installed via
// Homebrew (or similar) is invisible to production Silo. Probe known locations
// and return the first one that responds to `gh --version`.
const GH_CANDIDATE_PATHS = [
  "gh",
  "/opt/homebrew/bin/gh",  // Apple Silicon Homebrew
  "/usr/local/bin/gh",     // Intel Homebrew / manual install
  "/opt/local/bin/gh",     // MacPorts
  "/home/linuxbrew/.linuxbrew/bin/gh", // Linux Homebrew
];

// Host `ctx.process.exec` defaults cwd to the active workspace root and denies
// paths outside any open workspace. Auth and version probes don't need a repo,
// but we still run them from a real workspace folder so we never execute `gh`
// outside the workspace sandbox. When no folder is available yet, return
// undefined — callers skip the probe and let the retry loop pick it up once a
// workspace opens.
export async function probeCwd(ctx: ExtensionContext): Promise<string | undefined> {
  const state = ctx.workspaces.getState();
  if (state.activeId) {
    const active = ctx.workspaces.get(state.activeId);
    if (active?.folder) return active.folder;
  }
  const open = state.open[0] ?? state.all[0];
  if (open?.folder) return open.folder;
  return undefined;
}

function isPathDenied(err: unknown): boolean {
  if (err && typeof err === "object" && "name" in err && (err as { name: string }).name === "PathDeniedError") {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("PathDeniedError") || msg.includes("No workspace is open");
}

export async function resolveGhBin(ctx: ExtensionContext): Promise<string> {
  const cwd = await probeCwd(ctx);
  if (!cwd) return "gh"; // no workspace yet — defer probing to the retry loop
  for (const bin of GH_CANDIDATE_PATHS) {
    try {
      const r = await ctx.process.exec(bin, ["--version"], { cwd });
      if (r.code === 0) {
        if (bin !== "gh") ctx.log.info(`gh CLI resolved to ${bin}`);
        return bin;
      }
    } catch (err) {
      // PathDeniedError isn't "binary missing" — stop probing so checkAuth can
      // classify it. Other spawn failures mean try the next candidate path.
      if (isPathDenied(err)) throw err;
    }
  }
  return "gh"; // fall back; checkAuth will report it as missing
}

export type AuthState = "ok" | "unauthenticated" | "missing" | "deferred";

export async function checkAuth(ctx: ExtensionContext, ghBin: string): Promise<AuthState> {
  ctx.log.debug("Checking gh CLI authentication");
  const cwd = await probeCwd(ctx);
  if (!cwd) {
    // No workspace folder yet — don't run gh outside the workspace. The retry
    // loop re-checks once a workspace opens.
    ctx.log.debug("gh auth check deferred (no workspace folder yet)");
    return "deferred";
  }
  try {
    const result = await ctx.process.exec(ghBin, ["auth", "status"], { cwd });
    if (result.code === 0) {
      ctx.log.info("gh CLI is authenticated");
      return "ok";
    }
    // code 127 = command not found (shell wrapper); also check stderr for "not found"
    if (result.code === 127 || result.stderr?.includes("not found") || result.stderr?.includes("No such file")) {
      ctx.log.warn("gh CLI is not installed — visit https://cli.github.com to install");
      return "missing";
    }
    ctx.log.warn("gh CLI is not authenticated — run `gh auth login`");
    return "unauthenticated";
  } catch (err) {
    // Host path scoping (no workspace / denied cwd) is not "gh missing".
    if (isPathDenied(err)) {
      ctx.log.debug(`gh auth check deferred (${err})`);
      return "deferred";
    }
    // exec throws when the binary cannot be found at all
    ctx.log.warn(`gh CLI not found (${err}) — visit https://cli.github.com to install`);
    return "missing";
  }
}

// ─── PR data types ────────────────────────────────────────────────────────────
// Shapes mirror `gh pr list/view --json` output (GraphQL-backed), with unknown
// enum values kept as plain strings so new GitHub states degrade gracefully.

export interface PrActor {
  login: string;
}

export interface CheckRunContext {
  __typename: "CheckRun";
  name: string;
  status: string;      // "COMPLETED" | "IN_PROGRESS" | "QUEUED" | "PENDING" | …
  conclusion: string;  // "SUCCESS" | "FAILURE" | "NEUTRAL" | "CANCELLED" | "SKIPPED" | "" (while running)
  detailsUrl: string;
  workflowName: string;
  startedAt: string;
  completedAt: string;
}

export interface StatusContextEntry {
  __typename: "StatusContext";
  context: string;
  state: string;       // "SUCCESS" | "FAILURE" | "ERROR" | "PENDING" | "EXPECTED"
  targetUrl: string;
}

export type CheckContext = CheckRunContext | StatusContextEntry;

export interface PrReview {
  author: PrActor | null;
  state: string;       // "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING"
  submittedAt: string | null;
  body: string;
}

// `reviewRequests` entries are users ({login}) or teams ({name}/{slug}) —
// parsed defensively since the shape differs by __typename.
export interface ReviewRequest {
  login: string | null;
  name: string | null;
}

export interface PrLabel {
  name: string;
}

export type ReviewDecision = "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | "";

export interface PrListItem {
  number: number;
  title: string;
  url: string;
  author: PrActor | null;
  isDraft: boolean;
  state: "OPEN" | "MERGED" | "CLOSED";
  reviewDecision: ReviewDecision;
  reviewRequests: ReviewRequest[];
  latestReviews: PrReview[];
  statusCheckRollup: CheckContext[];
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  headRefName: string;
  baseRefName: string;
  labels: PrLabel[];
  mergeable: string;         // "MERGEABLE" | "CONFLICTING" | "UNKNOWN"
  mergeStateStatus: string;
  additions: number;
  deletions: number;
}

export interface PrComment {
  author: PrActor | null;
  body: string;
  createdAt: string;
  url: string;
}

/** One commit, as listed by `PrDetail.commits` — enough to render a commit
 * list row. A commit with multiple co-authors (e.g. paired with a bot) only
 * surfaces the first; good enough for a row, not worth a multi-author UI. */
export interface PrCommitListItem {
  sha: string;
  shortSha: string;
  subject: string;
  authorName: string;
  authorLogin: string | null;
  date: string;
}

/** Single-letter file status, matching Silo's git-explorer convention
 * (see `CommitFileChange` in packages/extensions-silo/src/git/git-api.ts)
 * so the commit-detail and PR-files UIs read the same status glyphs. */
export type CommitFileStatus = "A" | "M" | "D" | "R" | "C" | "T" | "U" | "X";

/** One changed file — shared shape for a single commit's files
 * (`PrCommitDetail.files`) and the PR's overall changed-file list
 * (`fetchPrFiles`), since both REST endpoints return the same fields. */
export interface PrFileChange {
  path: string;
  /** Original path for a rename/copy. */
  origPath?: string;
  status: CommitFileStatus;
  /** `null` when GitHub reports no line counts for this path. */
  additions: number | null;
  deletions: number | null;
}

/** A single commit's full message and changed files — fetched lazily (one
 * REST call per commit) only when a commit is opened, unlike the cheap
 * `PrDetail.commits` list. */
export interface PrCommitDetail extends PrCommitListItem {
  body: string;
  /** First parent's sha, or `null` for a root commit. Feeds the diff
   * provider's "original" side. */
  parentSha: string | null;
  files: PrFileChange[];
}

export interface PrDetail extends PrListItem {
  body: string;
  reviews: PrReview[];
  comments: PrComment[];
  changedFiles: number;
  closedAt: string | null;
  commits: PrCommitListItem[];
  /** Head/base commit shas — used (with `fetchPrMergeBase`) to diff the PR's
   * overall changed files against the merge-base, not the base branch's
   * live tip (which would show unrelated commits if it's moved since). */
  headRefOid: string;
  baseRefOid: string;
}

export interface GitHubApiError {
  kind: "unauthenticated" | "rate-limited" | "network" | "not-found";
  message: string;
}

export type PrListResult =
  | { ok: true; prs: PrListItem[] }
  | { ok: false; error: GitHubApiError };

export type PrDetailResult =
  | { ok: true; detail: PrDetail }
  | { ok: false; error: GitHubApiError };

export type PrCommitDetailResult =
  | { ok: true; detail: PrCommitDetail }
  | { ok: false; error: GitHubApiError };

// Maps a failed `gh` invocation's stderr to a typed error. Pure so the
// classification ladder can be unit-tested without spawning a process. Order
// matters: an auth failure that also mentions a rate limit is reported as
// unauthenticated, since re-auth is the actionable fix.
export function classifyFetchError(stderr: string): GitHubApiError {
  const s = stderr.toLowerCase();
  if (s.includes("401") || s.includes("403") || s.includes("authentication") || s.includes("not logged")) {
    return { kind: "unauthenticated", message: "gh CLI is not authenticated — run gh auth login" };
  }
  if (s.includes("404") || s.includes("could not resolve to a repository")) {
    return { kind: "not-found", message: "Repository not found — it may be private or the token lacks repo scope" };
  }
  if (s.includes("429") || s.includes("rate limit")) {
    return {
      kind: "rate-limited",
      message: "GitHub API rate limit exceeded — wait a bit, then Refresh, or slow polling in Settings",
    };
  }
  return {
    kind: "network",
    message: "Couldn’t reach GitHub — check your network and that gh is authenticated",
  };
}

// ─── Normalization ────────────────────────────────────────────────────────────
// `gh --json` only emits requested fields, and the merged-PR fetch requests a
// smaller set than the open-PR fetch — normalize both into a full PrListItem so
// downstream code never branches on which fetch produced an item.

type RawRecord = Record<string, unknown>;

function asActor(raw: unknown): PrActor | null {
  if (raw && typeof raw === "object" && typeof (raw as RawRecord).login === "string") {
    return { login: (raw as RawRecord).login as string };
  }
  return null;
}

function asReviews(raw: unknown): PrReview[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r: RawRecord) => ({
    author: asActor(r.author),
    state: typeof r.state === "string" ? r.state : "",
    submittedAt: typeof r.submittedAt === "string" ? r.submittedAt : null,
    body: typeof r.body === "string" ? r.body : "",
  }));
}

function asReviewRequests(raw: unknown): ReviewRequest[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r: RawRecord) => ({
    login: typeof r.login === "string" ? r.login : null,
    name: typeof r.name === "string" ? r.name : typeof r.slug === "string" ? r.slug : null,
  }));
}

function asChecks(raw: unknown): CheckContext[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (c: RawRecord) => c?.__typename === "CheckRun" || c?.__typename === "StatusContext",
  ) as unknown as CheckContext[];
}

function asLabels(raw: unknown): PrLabel[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((l: RawRecord) => typeof l?.name === "string")
    .map((l: RawRecord) => ({ name: l.name as string }));
}

function asCommits(raw: unknown): PrCommitListItem[] {
  if (!Array.isArray(raw)) return [];
  return (raw as RawRecord[]).map((c) => {
    const sha = typeof c.oid === "string" ? c.oid : "";
    const authors = Array.isArray(c.authors) ? (c.authors as RawRecord[]) : [];
    const first = authors[0];
    return {
      sha,
      shortSha: sha.slice(0, 7),
      subject: typeof c.messageHeadline === "string" ? c.messageHeadline : "",
      authorName: typeof first?.name === "string" ? first.name : "",
      authorLogin: typeof first?.login === "string" ? first.login : null,
      date: typeof c.authoredDate === "string" ? c.authoredDate : "",
    };
  });
}

export function normalizePrItem(raw: RawRecord, fallbackState: PrListItem["state"]): PrListItem {
  return {
    number: typeof raw.number === "number" ? raw.number : 0,
    title: typeof raw.title === "string" ? raw.title : "",
    url: typeof raw.url === "string" ? raw.url : "",
    author: asActor(raw.author),
    isDraft: raw.isDraft === true,
    state: typeof raw.state === "string" && ["OPEN", "MERGED", "CLOSED"].includes(raw.state)
      ? (raw.state as PrListItem["state"])
      : fallbackState,
    reviewDecision: typeof raw.reviewDecision === "string"
      ? (raw.reviewDecision as ReviewDecision)
      : "",
    reviewRequests: asReviewRequests(raw.reviewRequests),
    latestReviews: asReviews(raw.latestReviews),
    statusCheckRollup: asChecks(raw.statusCheckRollup),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
    mergedAt: typeof raw.mergedAt === "string" ? raw.mergedAt : null,
    headRefName: typeof raw.headRefName === "string" ? raw.headRefName : "",
    baseRefName: typeof raw.baseRefName === "string" ? raw.baseRefName : "",
    labels: asLabels(raw.labels),
    mergeable: typeof raw.mergeable === "string" ? raw.mergeable : "UNKNOWN",
    mergeStateStatus: typeof raw.mergeStateStatus === "string" ? raw.mergeStateStatus : "UNKNOWN",
    additions: typeof raw.additions === "number" ? raw.additions : 0,
    deletions: typeof raw.deletions === "number" ? raw.deletions : 0,
  };
}

export function normalizePrDetail(raw: RawRecord): PrDetail {
  const comments = Array.isArray(raw.comments)
    ? (raw.comments as RawRecord[]).map((c) => ({
      author: asActor(c.author),
      body: typeof c.body === "string" ? c.body : "",
      createdAt: typeof c.createdAt === "string" ? c.createdAt : "",
      url: typeof c.url === "string" ? c.url : "",
    }))
    : [];
  return {
    ...normalizePrItem(raw, "OPEN"),
    body: typeof raw.body === "string" ? raw.body : "",
    reviews: asReviews(raw.reviews),
    comments,
    changedFiles: typeof raw.changedFiles === "number" ? raw.changedFiles : 0,
    closedAt: typeof raw.closedAt === "string" ? raw.closedAt : null,
    commits: asCommits(raw.commits),
    headRefOid: typeof raw.headRefOid === "string" ? raw.headRefOid : "",
    baseRefOid: typeof raw.baseRefOid === "string" ? raw.baseRefOid : "",
  };
}

const FILE_STATUS_MAP: Record<string, CommitFileStatus> = {
  added: "A",
  removed: "D",
  modified: "M",
  renamed: "R",
  copied: "C",
  changed: "M",
  unchanged: "M",
};

function mapFileStatus(raw: string): CommitFileStatus {
  return FILE_STATUS_MAP[raw] ?? "M";
}

/** Shared row mapping for both REST "changed files" shapes — a single
 * commit's files (`GET commits/{sha}`) and a PR's overall files
 * (`GET pulls/{number}/files`) — which return identical field names. */
function normalizeFileChange(f: RawRecord): PrFileChange {
  return {
    path: typeof f.filename === "string" ? f.filename : "",
    origPath: typeof f.previous_filename === "string" ? f.previous_filename : undefined,
    status: mapFileStatus(typeof f.status === "string" ? f.status : ""),
    additions: typeof f.additions === "number" ? f.additions : null,
    deletions: typeof f.deletions === "number" ? f.deletions : null,
  };
}

/** Split a raw commit message into its subject line and body, the way
 * `git log`'s `%s`/`%b` do. */
function splitCommitMessage(message: string): { subject: string; body: string } {
  const idx = message.indexOf("\n");
  if (idx === -1) return { subject: message, body: "" };
  return { subject: message.slice(0, idx), body: message.slice(idx + 1).replace(/^\n+/, "").trim() };
}

/** Normalizes `gh api repos/{owner}/{repo}/commits/{sha}` (REST, unlike the
 * GraphQL-backed `pr view --json commits`) — chosen for this call because it's
 * the only endpoint that reports a commit's changed files and first parent in
 * one request. */
export function normalizePrCommitDetail(raw: RawRecord): PrCommitDetail {
  const sha = typeof raw.sha === "string" ? raw.sha : "";
  const commit = (raw.commit as RawRecord) ?? {};
  const author = (commit.author as RawRecord) ?? {};
  const ghAuthor = raw.author as RawRecord | null;
  const message = typeof commit.message === "string" ? commit.message : "";
  const { subject, body } = splitCommitMessage(message);
  const parents = Array.isArray(raw.parents) ? (raw.parents as RawRecord[]) : [];
  const parentSha = typeof parents[0]?.sha === "string" ? (parents[0]!.sha as string) : null;
  const filesRaw = Array.isArray(raw.files) ? (raw.files as RawRecord[]) : [];
  const files: PrFileChange[] = filesRaw.map(normalizeFileChange);
  return {
    sha,
    shortSha: sha.slice(0, 7),
    subject,
    body,
    authorName: typeof author.name === "string" ? author.name : "",
    authorLogin: ghAuthor && typeof ghAuthor.login === "string" ? ghAuthor.login : null,
    date: typeof author.date === "string" ? author.date : "",
    parentSha,
    files,
  };
}

// ─── Fetching ─────────────────────────────────────────────────────────────────
// All fetches go through `gh` so auth is handled by the gh CLI — no token
// management needed. Each `gh pr list/view --json` invocation is a single
// GraphQL request regardless of field count.

const OPEN_PR_FIELDS = [
  "number", "title", "url", "author", "isDraft", "reviewDecision",
  "reviewRequests", "latestReviews", "statusCheckRollup", "updatedAt",
  "createdAt", "headRefName", "baseRefName", "labels", "mergeable",
  "mergeStateStatus", "additions", "deletions",
].join(",");

const MERGED_PR_FIELDS = [
  "number", "title", "url", "author", "isDraft", "updatedAt", "createdAt",
  "mergedAt", "headRefName", "baseRefName", "labels", "additions", "deletions",
].join(",");

const DETAIL_PR_FIELDS = [
  "number", "title", "url", "body", "state", "author", "isDraft",
  "reviewDecision", "latestReviews", "reviews", "reviewRequests",
  "statusCheckRollup", "comments", "labels", "headRefName", "baseRefName",
  "mergeable", "mergeStateStatus", "additions", "deletions", "changedFiles",
  "createdAt", "updatedAt", "mergedAt", "closedAt", "commits",
  "headRefOid", "baseRefOid",
].join(",");

async function runPrList(
  ctx: ExtensionContext,
  owner: string,
  repo: string,
  cwd: string,
  ghBin: string,
  args: string[],
  fallbackState: PrListItem["state"],
): Promise<PrListResult> {
  const result = await ctx.process.exec(ghBin, args, { cwd });
  if (result.code !== 0) {
    const error = classifyFetchError(result.stderr);
    const msg = `gh pr list error (${error.kind}) for ${owner}/${repo}`;
    const detail = { stderr: result.stderr.trim() };
    if (error.kind === "network") ctx.log.error(msg, detail);
    else ctx.log.warn(msg, detail);
    return { ok: false, error };
  }
  try {
    const data = JSON.parse(result.stdout) as RawRecord[];
    const prs = data.map((raw) => normalizePrItem(raw, fallbackState));
    ctx.log.debug(`Fetched ${prs.length} ${fallbackState.toLowerCase()} PRs for ${owner}/${repo}`);
    return { ok: true, prs };
  } catch {
    ctx.log.error(`Failed to parse gh pr list response for ${owner}/${repo}`, { stdout: result.stdout.slice(0, 200) });
    return { ok: false, error: { kind: "network", message: "Unexpected response from gh — try Refresh or update the GitHub CLI" } };
  }
}

export async function fetchOpenPrs(
  ctx: ExtensionContext,
  owner: string,
  repo: string,
  cwd: string,
  ghBin: string,
): Promise<PrListResult> {
  ctx.log.debug(`Fetching open PRs for ${owner}/${repo}`);
  return runPrList(ctx, owner, repo, cwd, ghBin, [
    "pr", "list", "-R", `${owner}/${repo}`,
    "--state", "open", "--limit", String(OPEN_PRS_LIMIT),
    "--json", OPEN_PR_FIELDS,
  ], "OPEN");
}

export async function fetchMergedPrs(
  ctx: ExtensionContext,
  owner: string,
  repo: string,
  cwd: string,
  ghBin: string,
): Promise<PrListResult> {
  ctx.log.debug(`Fetching merged PRs for ${owner}/${repo}`);
  return runPrList(ctx, owner, repo, cwd, ghBin, [
    "pr", "list", "-R", `${owner}/${repo}`,
    "--state", "merged", "--limit", String(MERGED_PRS_LIMIT),
    "--json", MERGED_PR_FIELDS,
  ], "MERGED");
}

export async function fetchPrDetail(
  ctx: ExtensionContext,
  owner: string,
  repo: string,
  number: number,
  cwd: string,
  ghBin: string,
): Promise<PrDetailResult> {
  ctx.log.debug(`Fetching PR #${number} detail for ${owner}/${repo}`);
  const result = await ctx.process.exec(ghBin, [
    "pr", "view", String(number), "-R", `${owner}/${repo}`,
    "--json", DETAIL_PR_FIELDS,
  ], { cwd });
  if (result.code !== 0) {
    const error = classifyFetchError(result.stderr);
    ctx.log.warn(`gh pr view error (${error.kind}) for ${owner}/${repo}#${number}`, { stderr: result.stderr.trim() });
    return { ok: false, error };
  }
  try {
    return { ok: true, detail: normalizePrDetail(JSON.parse(result.stdout) as RawRecord) };
  } catch {
    ctx.log.error(`Failed to parse gh pr view response for ${owner}/${repo}#${number}`, { stdout: result.stdout.slice(0, 200) });
    return { ok: false, error: { kind: "network", message: "Unexpected response from gh — try Refresh or update the GitHub CLI" } };
  }
}

/** Full detail for one commit — message body, first parent, and changed
 * files. Lazy (a separate REST call per commit), unlike `PrDetail.commits`
 * which comes free with the PR detail fetch. */
export async function fetchPrCommitDetail(
  ctx: ExtensionContext,
  owner: string,
  repo: string,
  sha: string,
  cwd: string,
  ghBin: string,
): Promise<PrCommitDetailResult> {
  ctx.log.debug(`Fetching commit ${sha.slice(0, 7)} detail for ${owner}/${repo}`);
  const result = await ctx.process.exec(ghBin, [
    "api", `repos/${owner}/${repo}/commits/${sha}`,
  ], { cwd });
  if (result.code !== 0) {
    const error = classifyFetchError(result.stderr);
    ctx.log.warn(`gh api commit error (${error.kind}) for ${owner}/${repo}@${sha}`, { stderr: result.stderr.trim() });
    return { ok: false, error };
  }
  try {
    return { ok: true, detail: normalizePrCommitDetail(JSON.parse(result.stdout) as RawRecord) };
  } catch {
    ctx.log.error(`Failed to parse gh api commit response for ${owner}/${repo}@${sha}`, { stdout: result.stdout.slice(0, 200) });
    return { ok: false, error: { kind: "network", message: "Unexpected response from gh — try Refresh or update the GitHub CLI" } };
  }
}

export function normalizePrFiles(raw: unknown): PrFileChange[] {
  if (!Array.isArray(raw)) return [];
  return (raw as RawRecord[]).map(normalizeFileChange);
}

export type PrFilesResult =
  | { ok: true; files: PrFileChange[] }
  | { ok: false; error: GitHubApiError };

/** The PR's overall changed files — unlike a single commit's files, this is
 * already scoped to the PR's merge-base by GitHub itself (the same list
 * shown in the PR's "Files changed" tab), so no separate range computation
 * is needed for the *list*. Paginated: a large PR's file count can exceed
 * the REST default page size. */
export async function fetchPrFiles(
  ctx: ExtensionContext,
  owner: string,
  repo: string,
  number: number,
  cwd: string,
  ghBin: string,
): Promise<PrFilesResult> {
  ctx.log.debug(`Fetching changed files for ${owner}/${repo}#${number}`);
  const result = await ctx.process.exec(ghBin, [
    "api", `repos/${owner}/${repo}/pulls/${number}/files`, "--paginate",
  ], { cwd });
  if (result.code !== 0) {
    const error = classifyFetchError(result.stderr);
    ctx.log.warn(`gh api pulls/files error (${error.kind}) for ${owner}/${repo}#${number}`, { stderr: result.stderr.trim() });
    return { ok: false, error };
  }
  try {
    return { ok: true, files: normalizePrFiles(JSON.parse(result.stdout)) };
  } catch {
    ctx.log.error(`Failed to parse gh api pulls/files response for ${owner}/${repo}#${number}`, { stdout: result.stdout.slice(0, 200) });
    return { ok: false, error: { kind: "network", message: "Unexpected response from gh — try Refresh or update the GitHub CLI" } };
  }
}

/** The commit both `baseSha` and `headSha` descend from — the correct
 * "before" side for diffing a PR's *overall* changes. Diffing against
 * `baseSha` directly would show every commit landed on the base branch
 * since the PR forked as part of the PR's own change, same mistake as a
 * plain `git diff base head` instead of `git diff base...head`. Resolves to
 * `null` on any failure — callers fall back to `baseSha` (a less accurate
 * but still-functional diff origin) rather than blocking the page. */
export async function fetchPrMergeBase(
  ctx: ExtensionContext,
  owner: string,
  repo: string,
  baseSha: string,
  headSha: string,
  cwd: string,
  ghBin: string,
): Promise<string | null> {
  const result = await ctx.process.exec(ghBin, [
    "api", `repos/${owner}/${repo}/compare/${baseSha}...${headSha}`,
    "--jq", ".merge_base_commit.sha",
  ], { cwd });
  if (result.code !== 0) {
    ctx.log.debug(`Merge-base lookup failed for ${owner}/${repo} (${baseSha.slice(0, 7)}...${headSha.slice(0, 7)}) — falling back to baseSha`, {
      stderr: result.stderr.trim(),
    });
    return null;
  }
  const sha = result.stdout.trim();
  return sha || null;
}

export interface GithubBlobContent {
  text: string;
  /** True when the content can't be shown as text — a binary blob, or the
   * Contents API omitted inline content (a file over its ~1MB cap). */
  unavailable?: boolean;
}

function decodeGithubContent(b64: string): { text: string; binary: boolean } {
  const binaryStr = atob(b64.replace(/\n/g, ""));
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  // A NUL byte in the first chunk is the same heuristic git itself uses to
  // flag a blob as binary.
  const binary = bytes.subarray(0, 8000).includes(0);
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(bytes), binary };
}

/** A file's content at a specific commit ref, via the Contents API — unlike
 * local `git show`, this works even when `ref` was never fetched into the
 * local clone (e.g. a fork PR's head). Resolves to `{ text: "" }` when the
 * path doesn't exist at `ref` (the add/delete side of a diff). */
export async function fetchGithubBlobContent(
  ctx: ExtensionContext,
  owner: string,
  repo: string,
  path: string,
  ref: string,
  cwd: string,
  ghBin: string,
): Promise<GithubBlobContent> {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const result = await ctx.process.exec(ghBin, [
    "api", `repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
  ], { cwd });
  if (result.code !== 0) return { text: "" };
  try {
    const raw = JSON.parse(result.stdout) as RawRecord;
    if (typeof raw.content !== "string" || raw.encoding !== "base64") {
      return { text: "", unavailable: true };
    }
    const { text, binary } = decodeGithubContent(raw.content);
    return binary ? { text: "", unavailable: true } : { text };
  } catch {
    return { text: "" };
  }
}

// The signed-in user's login, used for authored / review-requested filtering.
export async function fetchViewerLogin(
  ctx: ExtensionContext,
  cwd: string,
  ghBin: string,
): Promise<string | null> {
  const result = await ctx.process.exec(ghBin, ["api", "user", "--jq", ".login"], { cwd });
  if (result.code !== 0) {
    ctx.log.warn("Failed to fetch viewer login", { stderr: result.stderr.trim() });
    return null;
  }
  const login = result.stdout.trim();
  return login || null;
}

export type MergeMethodsResult =
  | { ok: true; methods: RepoMergeMethods }
  | { ok: false; error: GitHubApiError };

export type MergePrResult =
  | { ok: true }
  | { ok: false; error: GitHubApiError };

export async function fetchRepoMergeMethods(
  ctx: ExtensionContext,
  owner: string,
  repo: string,
  cwd: string,
  ghBin: string,
): Promise<MergeMethodsResult> {
  const result = await ctx.process.exec(ghBin, [
    "repo", "view", `${owner}/${repo}`,
    "--json", "mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed",
  ], { cwd });
  if (result.code !== 0) {
    const error = classifyFetchError(result.stderr);
    ctx.log.warn(`gh repo view merge methods error (${error.kind}) for ${owner}/${repo}`, {
      stderr: result.stderr.trim(),
    });
    return { ok: false, error };
  }
  try {
    const raw = JSON.parse(result.stdout) as Record<string, unknown>;
    return {
      ok: true,
      methods: {
        merge: raw.mergeCommitAllowed === true,
        squash: raw.squashMergeAllowed === true,
        rebase: raw.rebaseMergeAllowed === true,
      },
    };
  } catch {
    ctx.log.error(`Failed to parse gh repo view response for ${owner}/${repo}`, {
      stdout: result.stdout.slice(0, 200),
    });
    return {
      ok: false,
      error: { kind: "network", message: "Unexpected response from gh — try Refresh or update the GitHub CLI" },
    };
  }
}

const MERGE_METHOD_FLAG: Record<MergeMethod, string> = {
  squash: "--squash",
  merge: "--merge",
  rebase: "--rebase",
};

export async function mergePr(
  ctx: ExtensionContext,
  owner: string,
  repo: string,
  number: number,
  method: MergeMethod,
  cwd: string,
  ghBin: string,
): Promise<MergePrResult> {
  ctx.log.info(`Merging PR #${number} (${method}) for ${owner}/${repo}`);
  const result = await ctx.process.exec(ghBin, [
    "pr", "merge", String(number),
    "-R", `${owner}/${repo}`,
    MERGE_METHOD_FLAG[method],
  ], { cwd });
  if (result.code !== 0) {
    const error = classifyFetchError(result.stderr);
    ctx.log.warn(`gh pr merge error (${error.kind}) for ${owner}/${repo}#${number}`, {
      stderr: result.stderr.trim(),
    });
    // Prefer the actionable stderr line when GitHub rejects a merge (permissions,
    // race, etc.) over the generic network fallback.
    const detail = result.stderr.trim().split("\n").filter(Boolean).pop();
    if (error.kind === "network" && detail) {
      return { ok: false, error: { kind: "network", message: detail } };
    }
    return { ok: false, error };
  }
  return { ok: true };
}
