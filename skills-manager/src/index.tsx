import type { Extension } from "@silo-code/sdk";
import STYLES from "./SkillsPanel.css";
import { SkillsPanel } from "./SkillsPanel";
import { requestBrowseSheet } from "./browse-intent";

const STYLE_ID = "silo-skills-manager-styles";

export const PANEL_ID = "skills";
export const REVEAL_COMMAND = "silo.skills-manager.reveal";
export const BROWSE_COMMAND = "silo.skills-manager.browse";

/**
 * `silo.skills-manager` — hybrid Agent Skills panel: inventory of project +
 * user installs, with a dock-anchored sheet to browse/install from skills.sh.
 *
 * Opens the browse sheet via the public `ctx.layout.openPanelSheet` (RFC
 * 0029) — built entirely against `@silo-code/sdk`, no host-internal import —
 * so browse/install can push the center dock without a modal from a
 * third-party extension build.
 */
export const extension: Extension = {
  id: "silo.skills-manager",
  activate(ctx) {
    const styleEl = document.createElement("style");
    styleEl.id = STYLE_ID;
    styleEl.textContent = STYLES;
    document.head.appendChild(styleEl);

    ctx.registerSidePanel({
      id: PANEL_ID,
      location: "right",
      title: "Skills",
      order: 4,
      lazyMount: true,
      component: ({ active, storage, hydrated }) => (
        <SkillsPanel
          ctx={ctx}
          panelId={PANEL_ID}
          active={active}
          storage={storage}
          hydrated={hydrated}
        />
      ),
    });

    ctx.registerCommand({
      id: REVEAL_COMMAND,
      label: "Skills: Show Panel",
      run: () => ctx.layout.revealSidePanel(PANEL_ID),
    });

    ctx.registerCommand({
      id: BROWSE_COMMAND,
      label: "Skills: Browse skills.sh",
      run: () => {
        // Force-mounts the panel if it's still lazy (never yet revealed) —
        // `SkillsPanel` isn't listening on browse-intent.ts's pub/sub until it
        // mounts, so without this a command-palette invocation before the
        // panel's first reveal would set the "pending" flag and never get
        // picked up. `openPanelSheet` (called once `SkillsPanel` does catch
        // the request below) reveals again too, but that's a no-op by then.
        ctx.layout.revealSidePanel(PANEL_ID);
        requestBrowseSheet();
      },
    });
  },
  deactivate() {
    document.getElementById(STYLE_ID)?.remove();
  },
};
