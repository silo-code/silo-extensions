import { describe, it, expect } from "vitest";
import { parseGitHubRemote, pickGitHubRemote } from "./parse-remote";

describe("parseGitHubRemote", () => {
  it("parses SSH remotes with and without the .git suffix", () => {
    expect(parseGitHubRemote("git@github.com:owner/repo.git")).toEqual({ owner: "owner", repo: "repo" });
    expect(parseGitHubRemote("git@github.com:owner/repo")).toEqual({ owner: "owner", repo: "repo" });
  });

  it("parses HTTPS and HTTP remotes", () => {
    expect(parseGitHubRemote("https://github.com/owner/repo.git")).toEqual({ owner: "owner", repo: "repo" });
    expect(parseGitHubRemote("https://github.com/owner/repo")).toEqual({ owner: "owner", repo: "repo" });
    expect(parseGitHubRemote("http://github.com/owner/repo")).toEqual({ owner: "owner", repo: "repo" });
  });

  it("strips a trailing path after the repo", () => {
    expect(parseGitHubRemote("https://github.com/owner/repo/tree/main")).toEqual({ owner: "owner", repo: "repo" });
  });

  it("preserves dots and hyphens in repo names", () => {
    expect(parseGitHubRemote("git@github.com:my-org/my.repo-name.git")).toEqual({
      owner: "my-org",
      repo: "my.repo-name",
    });
  });

  it("trims surrounding whitespace", () => {
    expect(parseGitHubRemote("  git@github.com:owner/repo.git\n")).toEqual({ owner: "owner", repo: "repo" });
  });

  it("returns null for non-GitHub remotes", () => {
    expect(parseGitHubRemote("git@gitlab.com:owner/repo.git")).toBeNull();
    expect(parseGitHubRemote("https://bitbucket.org/owner/repo")).toBeNull();
  });

  it("returns null for empty or junk input", () => {
    expect(parseGitHubRemote("")).toBeNull();
    expect(parseGitHubRemote("not a url")).toBeNull();
  });
});

describe("pickGitHubRemote", () => {
  const remote = (name: string, fetchUrl: string) => ({ name, fetchUrl, pushUrl: fetchUrl });

  it("resolves the origin remote's repo", () => {
    expect(pickGitHubRemote([remote("origin", "git@github.com:owner/repo.git")])).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("picks origin regardless of its position in the list", () => {
    expect(
      pickGitHubRemote([
        remote("fork", "git@github.com:me/repo.git"),
        remote("origin", "git@github.com:owner/repo.git"),
        remote("upstream", "git@github.com:other/repo.git"),
      ]),
    ).toEqual({ owner: "owner", repo: "repo" });
  });

  it("uses the fetch url, not a diverging pushurl", () => {
    expect(
      pickGitHubRemote([
        {
          name: "origin",
          fetchUrl: "https://github.com/owner/repo.git",
          pushUrl: "git@github.com:fork-owner/repo.git",
        },
      ]),
    ).toEqual({ owner: "owner", repo: "repo" });
  });

  it("returns null when there is no origin, even if another GitHub remote exists", () => {
    expect(pickGitHubRemote([remote("upstream", "git@github.com:other/repo.git")])).toBeNull();
  });

  it("returns null for an origin that isn't a GitHub remote", () => {
    expect(pickGitHubRemote([remote("origin", "git@gitlab.com:owner/repo.git")])).toBeNull();
  });

  it("returns null for a repo with no remotes", () => {
    expect(pickGitHubRemote([])).toBeNull();
  });
});
