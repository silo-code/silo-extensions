import type { ExtensionContext } from "@silo-code/sdk";

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

// Host `ctx.process.exec` defaults cwd to the active workspace root. With no
// workspace open that throws PathDeniedError — even with the `process`
// permission — which callers used to misreport as "gh CLI not found". Auth and
// version probes don't need a repo, so pick any available folder, else a
// platform root the `process` permission allows.
export async function probeCwd(ctx: ExtensionContext): Promise<string> {
  const state = ctx.workspaces.getState();
  if (state.activeId) {
    const active = ctx.workspaces.get(state.activeId);
    if (active?.folder) return active.folder;
  }
  const open = state.open[0] ?? state.all[0];
  if (open?.folder) return open.folder;
  const { os } = await ctx.system.getInfo();
  return os === "windows" ? "C:\\" : "/";
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

export interface PrDetail extends PrListItem {
  body: string;
  reviews: PrReview[];
  comments: PrComment[];
  changedFiles: number;
  closedAt: string | null;
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
  "createdAt", "updatedAt", "mergedAt", "closedAt",
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
