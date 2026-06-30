import type { ExtensionContext } from "@silo-code/sdk";

interface Props {
  close: () => void;
  ctx: ExtensionContext;
}

export function AuthHelpModal({ close, ctx }: Props) {
  return (
    <div className="gha-auth-help">
      <p className="gha-auth-help__text">
        GitHub Actions monitoring requires the{" "}
        <strong>GitHub CLI</strong> to be installed and authenticated.
      </p>
      <ol className="gha-auth-help__steps">
        <li>
          Install the CLI:{" "}
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); ctx.ui.openExternal("https://cli.github.com"); }}
          >
            cli.github.com
          </a>
        </li>
        <li>
          Run <code>gh auth login</code> in a terminal and follow the prompts.
        </li>
        <li>The extension will detect authentication automatically within 2 minutes.</li>
      </ol>
      <div className="gha-auth-help__actions">
        <button className="gha-auth-help__close" onClick={close}>Close</button>
      </div>
    </div>
  );
}
