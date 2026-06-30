import { useState, useEffect } from "react";
import { GitFork } from "@phosphor-icons/react";
import type { ExtensionContext } from "@silo-code/sdk";
import type { GhActionsService } from "./gh-actions-service";
import type { StatusBarState } from "./store";
import { ActionsModal } from "./actions-modal";
import { AuthHelpModal } from "./auth-help-modal";
import { getIconVariant, getLabel, getTooltip } from "./status-labels";

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
      className="gha-status"
      onClick={handleClick}
      title={getTooltip(state)}
      aria-label="GitHub Actions status"
    >
      <span className={`gha-status__icon gha-status__icon--${getIconVariant(state)}`}>
        <GitFork weight="bold" size={15} />
      </span>
      <span className="gha-status__label">{getLabel(state)}</span>
    </button>
  );
}
