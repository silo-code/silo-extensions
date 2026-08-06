import { Button, ModalActions, type ExtensionContext } from "@silo-code/sdk";
import type { GitHubApiError } from "../github-pr-api";

function copyText(ctx: ExtensionContext, text: string) {
  void navigator.clipboard.writeText(text).then(() => {
    ctx.ui.notify("info", "Copied to clipboard.");
  });
}

function ErrorDetailModal({
  ctx,
  error,
  close,
}: {
  ctx: ExtensionContext;
  error: GitHubApiError;
  close: () => void;
}) {
  const commandText = error.command?.join(" ") ?? null;
  const detailText = error.detail || error.message;
  const copyPayload = [commandText, detailText].filter(Boolean).join("\n\n");
  return (
    <div className="ghpr-error-modal">
      <p className="ghpr-error-modal__message">{error.message}</p>
      {commandText && (
        <>
          <div className="ghpr-error-modal__label">Command</div>
          <pre className="ghpr-error-modal__pre">{commandText}</pre>
        </>
      )}
      <div className="ghpr-error-modal__label">Details</div>
      <pre className="ghpr-error-modal__pre">{detailText}</pre>
      <ModalActions>
        <Button onClick={() => copyText(ctx, copyPayload)}>Copy</Button>
        <Button variant="primary" onClick={() => close()}>Close</Button>
      </ModalActions>
    </div>
  );
}

/** Pops a modal with the failed `gh` command and its raw output — the
 * "Details" action behind every error banner in this extension, so a network
 * or auth failure is reproducible outside the panel instead of stuck behind a
 * one-line classified message. */
export function showErrorDetail(ctx: ExtensionContext, error: GitHubApiError, title = "Error details") {
  void ctx.ui.showModal((close) => <ErrorDetailModal ctx={ctx} error={error} close={close} />, {
    title,
    dismissible: true,
    size: "md",
  });
}
