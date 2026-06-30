import { useState, useEffect } from "react";
import { GitFork } from "@phosphor-icons/react";
import type { ExtensionContext } from "@silo-code/sdk";
import type { GhActionsService } from "./gh-actions-service";
import type { StatusBarState } from "./store";
import { ActionsModal } from "./actions-modal";
import { AuthHelpModal } from "./auth-help-modal";

interface Props {
  ctx: ExtensionContext;
  service: GhActionsService;
}

export function GhActionsStatusItem({ ctx, service }: Props) {
  const [state, setState] = useState<StatusBarState>(() => service.getStatusBarState());

  useEffect(() => {
    const refresh = () => setState(service.getStatusBarState());
    const unsubStore = service.subscribe(refresh);
    const subWs = ctx.workspaces.subscribe(refresh);
    return () => { unsubStore(); subWs.dispose(); };
  }, [service, ctx]);

  if (state.kind === "hidden") return null;

  const handleClick = () => {
    if (state.kind === "gh-missing" || state.kind === "unauthenticated") {
      ctx.ui.showModal((close) => <AuthHelpModal close={close} ctx={ctx} />, {
        title: "GitHub Actions — Setup",
        dismissible: true,
        size: "md",
      });
      return;
    }
    if (state.kind === "no-repo" || state.kind === "checking") return;
    ctx.ui.showModal(
      (close) => <ActionsModal ctx={ctx} service={service} close={close} />,
      { title: "GitHub Actions", dismissible: true, size: "lg" },
    );
  };

  return (
    <button
      className="gh-actions-status"
      onClick={handleClick}
      title={getTooltip(state)}
      aria-label="GitHub Actions status"
    >
      <span className={`gh-actions-status__icon gh-actions-status__icon--${getIconVariant(state)}`}>
        <GitFork weight="bold" size={15} />
      </span>
      <span className="gh-actions-status__label">{getLabel(state)}</span>
    </button>
  );
}

function getIconVariant(state: StatusBarState): string {
  if (state.kind === "gh-missing") return "failed";
  if (state.kind === "unauthenticated") return "failed";
  if (state.kind === "api-error") return "failed";
  if (state.kind === "ok" && state.failed > 0) return "failed";
  return "dim";
}

function getLabel(state: StatusBarState): string {
  switch (state.kind) {
    case "gh-missing": return "Actions: cli missing";
    case "unauthenticated": return "Actions: Auth failed";
    case "api-error": return "Actions: Error";
    case "no-repo": return "Actions: No git repository";
    case "checking": return "Actions: Checking...";
    case "ok":
      if (state.failed > 0 && state.running > 0) return `Actions: ${state.failed} failed · ${state.running} running`;
      if (state.failed > 0) return `Actions: ${state.failed} failed`;
      if (state.running > 0) return `Actions: ${state.running} running`;
      return "Actions: ok";
    default: return "Actions";
  }
}

function getTooltip(state: StatusBarState): string {
  switch (state.kind) {
    case "gh-missing": return "GitHub Actions: gh CLI not installed — click for setup";
    case "unauthenticated": return "GitHub Actions: gh CLI not authenticated — click for setup";
    case "api-error": return `GitHub Actions: ${state.message}`;
    case "no-repo": return "GitHub Actions: no git repository in this workspace";
    case "checking": return "GitHub Actions: checking...";
    case "ok": {
      const parts: string[] = [];
      if (state.failed > 0) parts.push(`${state.failed} failed`);
      if (state.running > 0) parts.push(`${state.running} running`);
      return parts.length ? `GitHub Actions: ${parts.join(", ")}` : "GitHub Actions: all clear";
    }
    default: return "GitHub Actions";
  }
}
