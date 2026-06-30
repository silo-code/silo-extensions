import type { ExtensionContext } from "@silo-code/sdk";

// How many recent runs to request per repo. GitHub returns newest-first, so this
// is a ceiling on how far back the panel and counts look.
const RUNS_PER_PAGE = 50;

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

export async function resolveGhBin(ctx: ExtensionContext): Promise<string> {
  for (const bin of GH_CANDIDATE_PATHS) {
    try {
      const r = await ctx.process.exec(bin, ["--version"], {});
      if (r.code === 0) {
        if (bin !== "gh") ctx.log.info(`gh CLI resolved to ${bin}`);
        return bin;
      }
    } catch {
      // binary not found at this path — try next
    }
  }
  return "gh"; // fall back; checkAuth will report it as missing
}

export interface WorkflowRun {
  id: number;
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion:
  | "success"
  | "failure"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | "action_required"
  | null;
  html_url: string;
  head_branch: string;
  event: string;
  run_number: number;
  created_at: string;
  updated_at: string;
  pull_requests: Array<{ number: number; url: string }>;
}

export interface GitHubApiError {
  kind: "unauthenticated" | "rate-limited" | "network" | "not-found";
  message: string;
}

type FetchRunsResult =
  | { ok: true; runs: WorkflowRun[] }
  | { ok: false; error: GitHubApiError };

// Maps a failed `gh api` invocation's stderr to a typed error. Pure so the
// classification ladder can be unit-tested without spawning a process. Order
// matters: an auth failure that also mentions a rate limit is reported as
// unauthenticated, since re-auth is the actionable fix.
export function classifyFetchError(stderr: string): GitHubApiError {
  const s = stderr.toLowerCase();
  if (s.includes("401") || s.includes("403") || s.includes("authentication") || s.includes("not logged")) {
    return { kind: "unauthenticated", message: "gh CLI is not authenticated — run gh auth login" };
  }
  if (s.includes("404")) {
    return { kind: "not-found", message: "Actions not found — Actions may be disabled or the token lacks workflow scope" };
  }
  if (s.includes("429") || s.includes("rate limit")) {
    return { kind: "rate-limited", message: "GitHub API rate limit exceeded" };
  }
  return { kind: "network", message: stderr.trim() || "gh api call failed" };
}

// Uses `gh api` so auth is handled by the gh CLI — no token management needed.
// Branch filtering is done client-side to avoid URL-encoding issues with branch
// names that contain slashes (e.g. feat/my-feature).
export async function fetchRuns(
  ctx: ExtensionContext,
  owner: string,
  repo: string,
  cwd: string,
  ghBin: string,
): Promise<FetchRunsResult> {
  const endpoint = `repos/${owner}/${repo}/actions/runs?per_page=${RUNS_PER_PAGE}`;
  const args = ["api", endpoint];

  ctx.log.debug(`Fetching runs for ${owner}/${repo}`);
  const result = await ctx.process.exec(ghBin, args, { cwd });

  if (result.code !== 0) {
    const error = classifyFetchError(result.stderr);
    const msg = `gh api error (${error.kind}) for ${owner}/${repo}`;
    const detail = { stderr: result.stderr.trim() };
    if (error.kind === "network") ctx.log.error(msg, detail);
    else ctx.log.warn(msg, detail);
    return { ok: false, error };
  }

  try {
    const data = JSON.parse(result.stdout) as { workflow_runs: WorkflowRun[] };
    const runs = data.workflow_runs ?? [];
    ctx.log.debug(`Fetched ${runs.length} runs for ${owner}/${repo}`);
    return { ok: true, runs };
  } catch {
    ctx.log.error(`Failed to parse gh api response for ${owner}/${repo}`, { stdout: result.stdout.slice(0, 200) });
    return { ok: false, error: { kind: "network", message: "Failed to parse gh api response" } };
  }
}

export async function rerunWorkflow(
  ctx: ExtensionContext,
  owner: string,
  repo: string,
  runId: number,
  cwd: string,
  ghBin: string,
): Promise<{ ok: boolean; message?: string }> {
  const result = await ctx.process.exec(
    ghBin,
    ["api", `repos/${owner}/${repo}/actions/runs/${runId}/rerun`, "--method", "POST"],
    { cwd },
  );

  if (result.code === 0) {
    ctx.log.info(`Re-run triggered for workflow ${runId} in ${owner}/${repo}`);
    return { ok: true };
  }
  ctx.log.warn(`Re-run failed for workflow ${runId} in ${owner}/${repo}`, { stderr: result.stderr.trim() });
  return { ok: false, message: result.stderr.trim() || "Re-run failed" };
}

export type AuthState = "ok" | "unauthenticated" | "missing";

export async function checkAuth(ctx: ExtensionContext, ghBin: string): Promise<AuthState> {
  ctx.log.debug("Checking gh CLI authentication");
  try {
    const result = await ctx.process.exec(ghBin, ["auth", "status"], {});
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
    // exec throws when the binary cannot be found at all
    ctx.log.warn(`gh CLI not found (${err}) — visit https://cli.github.com to install`);
    return "missing";
  }
}
