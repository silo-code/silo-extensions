import type { Extension, SidePanelProps } from "@silo-code/sdk";
import GLOBAL_STYLES from "./styles.css";
import { IssueService } from "./issue-service";
import { IssuePanel } from "./views/IssuePanel";

const STYLE_ID = "silo-github-issues-styles";

export const extension: Extension = {
  id: "silo.github-issues",
  manifest: {
    name: "GitHub Issues",
    description:
      "GitHub issues for workspace repos in a side panel — status, labels, assignees, and drill-in details, with quick copy for handing work to an agent.",
  },
  activate(ctx) {
    if (!document.getElementById(STYLE_ID)) {
      const styleEl = document.createElement("style");
      styleEl.id = STYLE_ID;
      styleEl.textContent = GLOBAL_STYLES;
      document.head.appendChild(styleEl);
    }

    const service = new IssueService();

    ctx.subscriptions.push(
      ctx.registerSidePanel({
        id: "github-issues",
        location: "right",
        title: "Issues",
        order: 31,
        lazyMount: true,
        component: (props: SidePanelProps) => (
          <IssuePanel ctx={ctx} service={service} {...props} />
        ),
      }),
      { dispose: () => service.dispose() },
    );

    void service.init(ctx);
  },
  deactivate() {
    document.getElementById(STYLE_ID)?.remove();
  },
};
