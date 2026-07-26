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
