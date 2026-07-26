import { describe, it, expect } from "vitest";
import { parseGitHubRemote } from "./parse-remote";

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
