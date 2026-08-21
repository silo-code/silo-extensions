import type { GitRemote } from "@silo-code/git-api";

export interface GitHubRepo {
  owner: string;
  repo: string;
}

const SSH_RE = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/;
const HTTPS_RE = /^https?:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?(?:\/.*)?$/;

export function parseGitHubRemote(url: string): GitHubRepo | null {
  const ssh = SSH_RE.exec(url.trim());
  if (ssh) return { owner: ssh[1], repo: ssh[2] };

  const https = HTTPS_RE.exec(url.trim());
  if (https) return { owner: https[1], repo: https[2] };

  return null;
}

/**
 * Pick the GitHub repo a checkout belongs to out of `GitAPI.remotes()`.
 *
 * Deliberately `origin`-only, matching what the `git config --get
 * remote.origin.url` path has always done — a repo whose GitHub remote is
 * named something else (`upstream`, a fork setup) is still skipped, rather
 * than quietly changing which repo the panel tracks.
 */
export function pickGitHubRemote(
  remotes: readonly GitRemote[],
): GitHubRepo | null {
  const origin = remotes.find((r) => r.name === "origin");
  return origin ? parseGitHubRemote(origin.fetchUrl) : null;
}
