import { Globe } from "@phosphor-icons/react";
import type { DockPanelProps, Extension } from "@silo-code/sdk";
import { WebViewerPanel } from "./WebViewerPanel";

/* -------------------------------------------------------------------------- */
/* Styles. Runtime-loaded extensions must inject their own <style> — the host  */
/* only imports the JS bundle. Use --silo-* design tokens only so the panel    */
/* themes correctly and scales with uiFontSize.                                */
/* -------------------------------------------------------------------------- */

const STYLE_ID = "silo-web-viewer-styles";

const STYLES = `
.web-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.web-viewer-bar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 6px;
  background: var(--silo-color-toolbar-bg);
  border-bottom: 1px solid var(--silo-color-border);
  flex-shrink: 0;
}

.web-viewer-nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--silo-color-toolbar-text);
  border-radius: var(--silo-radius-sm);
  cursor: pointer;
  opacity: 1;
}

.web-viewer-nav-btn:hover:not(:disabled) {
  background: var(--silo-color-bg-hover);
}

.web-viewer-nav-btn:disabled {
  color: var(--silo-color-toolbar-text-disabled);
  cursor: default;
}

.web-viewer-url-input {
  flex: 1;
  min-width: 0;
  height: 26px;
  padding: 0 8px;
  font-size: var(--silo-font-size-sm);
  font-family: var(--silo-font-ui);
  background: var(--silo-color-toolbar-input-bg);
  color: var(--silo-color-toolbar-text);
  border: 1px solid var(--silo-color-toolbar-input-bg);
  border-radius: var(--silo-radius-sm);
  outline: none;
}

.web-viewer-url-input:focus {
  border-color: var(--silo-color-accent);
}

.web-viewer-content {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
}

.web-viewer-frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: none;
  background: var(--silo-color-content-bg);
  color-scheme: inherit;
}

.web-viewer-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--silo-color-content-bg);
  color: var(--silo-color-content-text);
  font-size: var(--silo-font-size-sm);
  font-family: var(--silo-font-ui);
}

.web-viewer-blocked {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: var(--silo-color-content-bg);
  color: var(--silo-color-content-text);
  font-size: var(--silo-font-size-sm);
  font-family: var(--silo-font-ui);
}

.web-viewer-blocked svg {
  opacity: 0.4;
}

.web-viewer-blocked p {
  margin: 0;
}

.web-viewer-open-external {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border: 1px solid var(--silo-color-border-strong);
  border-radius: var(--silo-radius-sm);
  background: transparent;
  color: var(--silo-color-toolbar-text);
  font-size: var(--silo-font-size-sm);
  font-family: var(--silo-font-ui);
  cursor: pointer;
}

.web-viewer-open-external:hover {
  background: var(--silo-color-bg-hover);
}
`;

export const extension: Extension = {
  id: "silo.web-viewer",
  manifest: {
    name: "Web Viewer",
    description:
      "Browse URLs — remote docs, local dev servers, or file:// HTML — alongside your code.",
  },
  activate(ctx) {
    if (!document.getElementById(STYLE_ID)) {
      const el = document.createElement("style");
      el.id = STYLE_ID;
      el.textContent = STYLES;
      document.head.appendChild(el);
    }
    ctx.subscriptions.push({
      dispose() {
        document.getElementById(STYLE_ID)?.remove();
      },
    });

    ctx.registerDockPanelKind({
      id: "web-viewer",
      component: ((props) => (
        <WebViewerPanel {...props} ctx={ctx} />
      )) as React.ComponentType<DockPanelProps>,
      addMenuItem: {
        label: "New Web Viewer",
        icon: <Globe size={14} weight="regular" />,
        params: { title: "Web" },
      },
    });

    ctx.registerCommand({
      id: "silo.web-viewer.open",
      label: "Web Viewer: Open",
      run: () => ctx.layout.openPanel("web-viewer", { title: "Web" }),
    });
  },
};
