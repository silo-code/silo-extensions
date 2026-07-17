import { GithubLogo } from "@phosphor-icons/react";
import type { Extension } from "@silo-code/sdk";
import GLOBAL_STYLES from "./styles.css";
import STATUS_ITEM_STYLES from "./status-item.css";
import MODAL_STYLES from "./actions-modal.css";
import WORKSPACE_PROPERTY_PAGE_STYLES from "./workspace-property-page.css";
import { GhActionsService } from "./gh-actions-service";
import { GhActionsStatusItem } from "./status-item";
import { GhActionsSettings } from "./settings-page";
import { GhActionsWorkspaceSettings } from "./workspace-property-page";
import { ghStore } from "./store";

const STYLE_ID = "silo-github-actions-styles";

export const extension: Extension = {
  id: "silo.github-actions",
  manifest: {
    name: "GitHub Actions",
    description:
      "Monitor GitHub Actions workflow runs across workspace repos — status bar, workspace badges, and failure notifications.",
  },
  activate(ctx) {
    if (!document.getElementById(STYLE_ID)) {
      const styleEl = document.createElement("style");
      styleEl.id = STYLE_ID;
      styleEl.textContent =
        GLOBAL_STYLES + STATUS_ITEM_STYLES + MODAL_STYLES + WORKSPACE_PROPERTY_PAGE_STYLES;
      document.head.appendChild(styleEl);
    }

    const service = new GhActionsService();

    ctx.subscriptions.push(
      ctx.registerStatusItem({
        id: "gh-actions",
        alignment: "right",
        priority: 1000,
        component: () => <GhActionsStatusItem ctx={ctx} service={service} />,
      }),
      ctx.workspaces.registerBadge({
        id: "silo.github-actions.badges",
        provide: (workspaceId) => service.getBadgesFor(workspaceId),
      }),
      ctx.workspaces.registerStatus({
        id: "silo.github-actions.status",
        provide: (workspaceId) => service.getDecorationsFor(workspaceId),
      }),
      ctx.registerSettingsPage({
        id: "silo.github-actions",
        title: "GitHub Actions",
        group: "8_integrations",
        order: 1,
        component: () => <GhActionsSettings ctx={ctx} />,
      }),
      ctx.workspaces.registerPropertyPage({
        id: "silo.github-actions.properties",
        title: "GitHub Actions",
        icon: <GithubLogo size={14} />,
        component: (props) => <GhActionsWorkspaceSettings {...props} service={service} />,
        visible: (ws) => ghStore.getRepoStates(ws.id).some((s) => s.repoInfo !== null),
      }),
      { dispose: () => service.dispose() },
    );

    service.init(ctx);
  },
  deactivate() {
    document.getElementById(STYLE_ID)?.remove();
  },
};
