import type { Extension, SidePanelProps } from "@silo-code/sdk";
import GLOBAL_STYLES from "./styles.css";
import { PrService } from "./pr-service";
import { PrPanel } from "./views/PrPanel";
import { PrSettingsPage } from "./settings-page";

const STYLE_ID = "silo-github-prs-styles";

export const extension: Extension = {
  id: "silo.github-prs",
  manifest: {
    name: "GitHub Pull Requests",
    description:
      "GitHub pull requests for workspace repos in a side panel — review state, CI checks, and drill-in details at a glance.",
  },
  activate(ctx) {
    if (!document.getElementById(STYLE_ID)) {
      const styleEl = document.createElement("style");
      styleEl.id = STYLE_ID;
      styleEl.textContent = GLOBAL_STYLES;
      document.head.appendChild(styleEl);
    }

    const service = new PrService();

    ctx.subscriptions.push(
      ctx.registerSidePanel({
        id: "github-prs",
        location: "right",
        title: "PRS",
        order: 30,
        lazyMount: true,
        component: (props: SidePanelProps) => (
          <PrPanel ctx={ctx} service={service} {...props} />
        ),
      }),
      ctx.registerSettingsPage({
        id: "silo.github-prs",
        title: "GitHub Pull Requests",
        group: "8_integrations",
        order: 2,
        component: () => <PrSettingsPage ctx={ctx} />,
      }),
      // Workspace property page intentionally not registered for now.
      { dispose: () => service.dispose() },
    );

    void service.init(ctx);
  },
  deactivate() {
    document.getElementById(STYLE_ID)?.remove();
  },
};
