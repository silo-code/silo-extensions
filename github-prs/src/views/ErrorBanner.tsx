import type { ExtensionContext } from "@silo-code/sdk";
import type { GitHubApiError } from "../github-pr-api";
import { showErrorDetail } from "./error-detail";

export function ErrorBanner({
  ctx,
  error,
  title,
  inline,
}: {
  ctx: ExtensionContext;
  error: GitHubApiError;
  title?: string;
  inline?: boolean;
}) {
  return (
    <div className={`ghpr-error-banner${inline ? " ghpr-error-banner--inline" : ""}`}>
      <span className="ghpr-error-banner__message">{error.message}</span>
      <button
        type="button"
        className="ghpr-error-banner__details"
        onClick={() => showErrorDetail(ctx, error, title)}
      >
        Details
      </button>
    </div>
  );
}
