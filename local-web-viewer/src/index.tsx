import { Globe } from "@phosphor-icons/react";
import type { DockPanelProps, Extension } from "@silo-code/sdk";
import { LocalWebViewerPanel } from "./WebViewerPanel";

/* -------------------------------------------------------------------------- */
/* Styles. Runtime-loaded extensions must inject their own <style> — the host  */
/* only imports the JS bundle. Use --silo-* design tokens only so the panel    */
/* themes correctly and scales with uiFontSize.                                */
/* -------------------------------------------------------------------------- */

const STYLE_ID = "silo-local-web-viewer-styles";

const STYLES = `
.lwv {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  color-scheme: inherit;
}

.lwv ::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.lwv ::-webkit-scrollbar-track {
  background: var(--silo-color-content-bg);
}

.lwv ::-webkit-scrollbar-thumb {
  background: var(--silo-color-border-strong);
  border-radius: 4px;
  border: 2px solid var(--silo-color-content-bg);
}

.lwv ::-webkit-scrollbar-thumb:hover {
  background: var(--silo-color-toolbar-text-disabled);
  border: 2px solid var(--silo-color-content-bg);
}

.lwv-bar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 6px;
  background: var(--silo-color-toolbar-bg);
  border-bottom: 1px solid var(--silo-color-border);
  flex-shrink: 0;
}

.lwv-btn {
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

.lwv-btn:hover:not(:disabled) {
  background: var(--silo-color-bg-hover);
}

.lwv-btn:disabled {
  color: var(--silo-color-toolbar-text-disabled);
  cursor: default;
}

.lwv-url-input {
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

.lwv-url-input:focus {
  border-color: var(--silo-color-accent);
}

.lwv-content {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
}

.lwv-frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: none;
  background: var(--silo-color-content-bg);
  color-scheme: inherit;
}

.lwv-empty {
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

.lwv-overlay {
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

.lwv-overlay svg {
  opacity: 0.4;
}

.lwv-overlay p {
  margin: 0;
}

.lwv-open-external {
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

.lwv-open-external:hover {
  background: var(--silo-color-bg-hover);
}

@keyframes lwv-spin {
  to { transform: rotate(360deg); }
}

.lwv-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--silo-color-border);
  border-top-color: var(--silo-color-accent);
  border-radius: 50%;
  animation: lwv-spin 0.8s linear infinite;
}
`;

export const extension: Extension = {
  id: "silo.local-web-viewer",
  manifest: {
    name: "Local Web Viewer",
    description:
      "Embed local dev servers and file:// pages as dock panels alongside your code. Best suited for localhost — remote URLs that block iframe embedding will show a fallback instead.",
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
      id: "local-web-viewer",
      component: ((props) => (
        <LocalWebViewerPanel {...props} ctx={ctx} />
      )) as React.ComponentType<DockPanelProps>,
      addMenuItem: {
        label: "New Local Web Viewer",
        icon: <Globe size={14} weight="regular" />,
        params: { title: "Local" },
      },
    });

    ctx.registerCommand({
      id: "silo.local-web-viewer.open",
      label: "Local Web Viewer: Open",
      run: () => ctx.layout.openPanel("local-web-viewer", { title: "Local" }),
    });
  },
};
