import type { ExtensionContext } from "@silo-code/sdk";

// Ceilings on how many issues a single fetch returns. GitHub returns newest-
// first, so these bound how far back the panel looks.
const OPEN_ISSUES_LIMIT = 50;
const CLOSED_ISSUES_LIMIT = 20;

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

// ─── Issue data types ─────────────────────────────────────────────────────────
// Shapes mirror `gh issue list/view --json` output (GraphQL-backed), with
// unknown enum values kept as plain strings so new GitHub states degrade
// gracefully.

export interface IssueActor {
  login: string;
}

export interface IssueLabel {
  name: string;
  color: string;
}

export interface IssueAssignee {
  login: string;
}

export interface IssueMilestone {
  title: string;
}

export interface IssueComment {
  author: IssueActor | null;
  body: string;
  createdAt: string;
  url: string;
}

export type IssueStateReason = "COMPLETED" | "NOT_PLANNED" | "REOPENED" | null;

export interface IssueListItem {
  number: number;
  title: string;
  url: string;
  author: IssueActor | null;
  state: "OPEN" | "CLOSED";
  stateReason: IssueStateReason;
  labels: IssueLabel[];
  assignees: IssueAssignee[];
  milestone: IssueMilestone | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface IssueDetail extends IssueListItem {
  body: string;
  comments: IssueComment[];
}

export interface GitHubApiError {
  kind: "unauthenticated" | "rate-limited" | "network" | "not-found";
  message: string;
}

export type IssueListResult =
  | { ok: true; issues: IssueListItem[] }
  | { ok: false; error: GitHubApiError };

export type IssueDetailResult =
  | { ok: true; detail: IssueDetail }
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
      message: "GitHub API rate limit exceeded — wait a bit, then Refresh",
    };
  }
  return {
    kind: "network",
    message: "Couldn’t reach GitHub — check your network and that gh is authenticated",
  };
}

// ─── Normalization ────────────────────────────────────────────────────────────
// `gh --json` only emits requested fields — normalize into full types so
// downstream code never has to guard against missing keys.

type RawRecord = Record<string, unknown>;

function asActor(raw: unknown): IssueActor | null {
  if (raw && typeof raw === "object" && typeof (raw as RawRecord).login === "string") {
    return { login: (raw as RawRecord).login as string };
  }
  return null;
}

function asLabels(raw: unknown): IssueLabel[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((l: RawRecord) => typeof l?.name === "string")
    .map((l: RawRecord) => ({
      name: l.name as string,
      color: typeof l.color === "string" ? l.color : "888888",
    }));
}

function asAssignees(raw: unknown): IssueAssignee[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a: RawRecord) => typeof a?.login === "string")
    .map((a: RawRecord) => ({ login: a.login as string }));
}

function asMilestone(raw: unknown): IssueMilestone | null {
  if (raw && typeof raw === "object" && typeof (raw as RawRecord).title === "string") {
    return { title: (raw as RawRecord).title as string };
  }
  return null;
}

function asStateReason(raw: unknown): IssueStateReason {
  return raw === "COMPLETED" || raw === "NOT_PLANNED" || raw === "REOPENED" ? raw : null;
}

export function normalizeIssueItem(raw: RawRecord): IssueListItem {
  return {
    number: typeof raw.number === "number" ? raw.number : 0,
    title: typeof raw.title === "string" ? raw.title : "",
    url: typeof raw.url === "string" ? raw.url : "",
    author: asActor(raw.author),
    state: raw.state === "CLOSED" ? "CLOSED" : "OPEN",
    stateReason: asStateReason(raw.stateReason),
    labels: asLabels(raw.labels),
    assignees: asAssignees(raw.assignees),
    milestone: asMilestone(raw.milestone),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
    closedAt: typeof raw.closedAt === "string" ? raw.closedAt : null,
  };
}

export function normalizeIssueDetail(raw: RawRecord): IssueDetail {
  const comments = Array.isArray(raw.comments)
    ? (raw.comments as RawRecord[]).map((c) => ({
      author: asActor(c.author),
      body: typeof c.body === "string" ? c.body : "",
      createdAt: typeof c.createdAt === "string" ? c.createdAt : "",
      url: typeof c.url === "string" ? c.url : "",
    }))
    : [];
  return {
    ...normalizeIssueItem(raw),
    body: typeof raw.body === "string" ? raw.body : "",
    comments,
  };
}

// ─── Fetching ─────────────────────────────────────────────────────────────────
// All fetches go through `gh` so auth is handled by the gh CLI — no token
// management needed. Each `gh issue list/view --json` invocation is a single
// GraphQL request regardless of field count.

const ISSUE_LIST_FIELDS = [
  "number", "title", "url", "author", "state", "stateReason",
  "labels", "assignees", "milestone", "createdAt", "updatedAt", "closedAt",
].join(",");

const ISSUE_DETAIL_FIELDS = [
  "number", "title", "url", "body", "author", "state", "stateReason",
  "labels", "assignees", "milestone", "comments",
  "createdAt", "updatedAt", "closedAt",
].join(",");

async function runIssueList(
  ctx: ExtensionContext,
  owner: string,
  repo: string,
  cwd: string,
  ghBin: string,
  args: string[],
): Promise<IssueListResult> {
  const result = await ctx.process.exec(ghBin, args, { cwd });
  if (result.code !== 0) {
    const error = classifyFetchError(result.stderr);
    const msg = `gh issue list error (${error.kind}) for ${owner}/${repo}`;
    const detail = { stderr: result.stderr.trim() };
    if (error.kind === "network") ctx.log.error(msg, detail);
    else ctx.log.warn(msg, detail);
    return { ok: false, error };
  }
  try {
    const data = JSON.parse(result.stdout) as RawRecord[];
    const issues = data.map((raw) => normalizeIssueItem(raw));
    ctx.log.debug(`Fetched ${issues.length} issues for ${owner}/${repo}`);
    return { ok: true, issues };
  } catch {
    ctx.log.error(`Failed to parse gh issue list response for ${owner}/${repo}`, { stdout: result.stdout.slice(0, 200) });
    return { ok: false, error: { kind: "network", message: "Unexpected response from gh — try Refresh or update the GitHub CLI" } };
  }
}

export async function fetchOpenIssues(
  ctx: ExtensionContext,
  owner: string,
  repo: string,
  cwd: string,
  ghBin: string,
): Promise<IssueListResult> {
  ctx.log.debug(`Fetching open issues for ${owner}/${repo}`);
  return runIssueList(ctx, owner, repo, cwd, ghBin, [
    "issue", "list", "-R", `${owner}/${repo}`,
    "--state", "open", "--limit", String(OPEN_ISSUES_LIMIT),
    "--json", ISSUE_LIST_FIELDS,
  ]);
}

export async function fetchClosedIssues(
  ctx: ExtensionContext,
  owner: string,
  repo: string,
  cwd: string,
  ghBin: string,
): Promise<IssueListResult> {
  ctx.log.debug(`Fetching closed issues for ${owner}/${repo}`);
  return runIssueList(ctx, owner, repo, cwd, ghBin, [
    "issue", "list", "-R", `${owner}/${repo}`,
    "--state", "closed", "--limit", String(CLOSED_ISSUES_LIMIT),
    "--json", ISSUE_LIST_FIELDS,
  ]);
}

export async function fetchIssueDetail(
  ctx: ExtensionContext,
  owner: string,
  repo: string,
  number: number,
  cwd: string,
  ghBin: string,
): Promise<IssueDetailResult> {
  ctx.log.debug(`Fetching issue #${number} detail for ${owner}/${repo}`);
  const result = await ctx.process.exec(ghBin, [
    "issue", "view", String(number), "-R", `${owner}/${repo}`,
    "--json", ISSUE_DETAIL_FIELDS,
  ], { cwd });
  if (result.code !== 0) {
    const error = classifyFetchError(result.stderr);
    ctx.log.warn(`gh issue view error (${error.kind}) for ${owner}/${repo}#${number}`, { stderr: result.stderr.trim() });
    return { ok: false, error };
  }
  try {
    return { ok: true, detail: normalizeIssueDetail(JSON.parse(result.stdout) as RawRecord) };
  } catch {
    ctx.log.error(`Failed to parse gh issue view response for ${owner}/${repo}#${number}`, { stdout: result.stdout.slice(0, 200) });
    return { ok: false, error: { kind: "network", message: "Unexpected response from gh — try Refresh or update the GitHub CLI" } };
  }
}

// The signed-in user's login, used for assignee / author filtering.
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

export type CloseReason = "completed" | "not planned";

export type IssueActionResult =
  | { ok: true }
  | { ok: false; error: GitHubApiError };

export async function closeIssue(
  ctx: ExtensionContext,
  owner: string,
  repo: string,
  number: number,
  reason: CloseReason,
  cwd: string,
  ghBin: string,
): Promise<IssueActionResult> {
  ctx.log.info(`Closing issue #${number} (${reason}) for ${owner}/${repo}`);
  const result = await ctx.process.exec(ghBin, [
    "issue", "close", String(number),
    "-R", `${owner}/${repo}`,
    "--reason", reason,
  ], { cwd });
  if (result.code !== 0) {
    const error = classifyFetchError(result.stderr);
    ctx.log.warn(`gh issue close error (${error.kind}) for ${owner}/${repo}#${number}`, {
      stderr: result.stderr.trim(),
    });
    const detail = result.stderr.trim().split("\n").filter(Boolean).pop();
    if (error.kind === "network" && detail) {
      return { ok: false, error: { kind: "network", message: detail } };
    }
    return { ok: false, error };
  }
  return { ok: true };
}

export async function reopenIssue(
  ctx: ExtensionContext,
  owner: string,
  repo: string,
  number: number,
  cwd: string,
  ghBin: string,
): Promise<IssueActionResult> {
  ctx.log.info(`Reopening issue #${number} for ${owner}/${repo}`);
  const result = await ctx.process.exec(ghBin, [
    "issue", "reopen", String(number),
    "-R", `${owner}/${repo}`,
  ], { cwd });
  if (result.code !== 0) {
    const error = classifyFetchError(result.stderr);
    ctx.log.warn(`gh issue reopen error (${error.kind}) for ${owner}/${repo}#${number}`, {
      stderr: result.stderr.trim(),
    });
    const detail = result.stderr.trim().split("\n").filter(Boolean).pop();
    if (error.kind === "network" && detail) {
      return { ok: false, error: { kind: "network", message: detail } };
    }
    return { ok: false, error };
  }
  return { ok: true };
}
