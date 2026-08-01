import type { DiffContentProvider, ExtensionContext } from "@silo-code/sdk";
import { fetchGithubBlobContent, type GithubBlobContent } from "./github-pr-api";
import type { PrService } from "./pr-service";

const UNAVAILABLE_PLACEHOLDER = "Binary or oversized file not shown.";

/** The `silo.github-prs` diff content provider — resolves both sides of a
 * commit's file diff from the GitHub Contents API rather than local git
 * objects, since a PR's commits (especially a fork's) may never be fetched
 * into the workspace's clone. Mirrors `silo.git`'s own provider
 * (packages/extensions-silo/src/git/index.ts) in shape, just sourcing content
 * over the network instead of `git show`. Registered once at activation;
 * opened via `ctx.editors.openDiff({ providerId: "silo.github-prs", args })`
 * from PrCommitView, which supplies every arg below explicitly (there's no
 * real workspace-relative `filePath` to infer `cwd` from — the diff's
 * `filePath` is a synthetic `owner/repo/path`, not a file on disk). */
export function createGithubDiffProvider(
  ctx: ExtensionContext,
  service: PrService,
): DiffContentProvider {
  return async (req) => {
    const args = req.args ?? {};
    const owner = typeof args.owner === "string" ? args.owner : undefined;
    const repo = typeof args.repo === "string" ? args.repo : undefined;
    const cwd = typeof args.cwd === "string" ? args.cwd : undefined;
    const commit = typeof args.commit === "string" ? args.commit : undefined;
    const parent = typeof args.parent === "string" ? args.parent : undefined;
    const path = typeof args.path === "string" ? args.path : undefined;
    const origPath = typeof args.origPath === "string" ? args.origPath : path;
    if (!owner || !repo || !cwd || !commit || !path) {
      return { original: "", modified: "" };
    }

    const ghBin = service.ghBin;
    const [originalResult, modifiedResult] = await Promise.all([
      // No parent (a root commit) means the file didn't exist before — an
      // empty original side, same convention as an added file.
      parent
        ? fetchGithubBlobContent(ctx, owner, repo, origPath ?? path, parent, cwd, ghBin)
        : Promise.resolve<GithubBlobContent>({ text: "" }),
      fetchGithubBlobContent(ctx, owner, repo, path, commit, cwd, ghBin),
    ]);

    if (originalResult.unavailable || modifiedResult.unavailable) {
      return { original: UNAVAILABLE_PLACEHOLDER, modified: UNAVAILABLE_PLACEHOLDER };
    }
    return { original: originalResult.text, modified: modifiedResult.text };
  };
}
