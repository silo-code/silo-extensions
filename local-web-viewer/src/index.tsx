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
  /* Suppress the native ring; focus is the shared accent ring from the global
     input:focus-visible rule in theme.css (higher specificity, so it still
     wins on focus). Don't also recolor the border on focus here, or the two
     accent rings stack into a double outline. */
  outline: none;
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

/* ── Picker button active state ─────────────────────────────────────────── */

.lwv-btn-active {
  background: color-mix(in srgb, var(--silo-color-accent, #4f8ef7) 15%, transparent) !important;
  color: var(--silo-color-accent, #4f8ef7) !important;
}

/* ── Marquee region-select overlay ──────────────────────────────────────── */

.lwv-marquee-overlay {
  position: absolute;
  inset: 0;
  cursor: crosshair;
  z-index: 10;
  user-select: none;
}

.lwv-marquee {
  position: absolute;
  border: 1px solid var(--silo-color-accent, #4f8ef7);
  background: color-mix(in srgb, var(--silo-color-accent, #4f8ef7) 15%, transparent);
}

/* ── Annotation modal internals ─────────────────────────────────────────── */

.lwv-ann {
  display: flex;
  flex-direction: column;
  /* The host's .silo-modal card has no max-height of its own — it sizes to
     content, so a tall full-page capture would push the card past the
     viewport top/bottom. Cap here and let .lwv-ann-canvas-wrap's existing
     overflow:auto scroll the image instead. */
  max-height: 85vh;
  min-height: 0;
  font-size: var(--silo-font-size-base, 13px);
  font-family: var(--silo-font-ui);
}

.lwv-ann-subtitle {
  margin: 0 0 10px;
  color: var(--silo-color-text-lo, rgba(128,128,128,0.7));
  font-size: var(--silo-font-size-sm, 12px);
}

.lwv-ann-footer-left {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-right: auto;
}

.lwv-ann-pen-label {
  font-size: var(--silo-font-size-base, 13px);
  color: var(--silo-color-text, currentColor);
  font-weight: 500;
  letter-spacing: 0.05em;
  user-select: none;
}

.lwv-ann-swatches {
  display: flex;
  gap: 7px;
}

.lwv-ann-swatch {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1.5px solid rgba(128,128,128,0.4);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
}

.lwv-ann-swatch-active {
  outline: 2px solid var(--silo-color-text, currentColor);
  outline-offset: 2px;
}

.lwv-ann-sep {
  width: 1px;
  height: 20px;
  background: var(--silo-color-border, rgba(128,128,128,0.3));
  margin: 0 2px;
}

.lwv-ann-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  flex-shrink: 0;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--silo-color-text, currentColor);
  border-radius: var(--silo-radius-sm, 4px);
}

.lwv-ann-action:hover:not(:disabled) {
  background: var(--silo-color-bg-hover, rgba(128,128,128,0.08));
}

.lwv-ann-action:disabled {
  color: var(--silo-color-text-lo, rgba(128,128,128,0.5));
  cursor: default;
}

.lwv-ann-canvas-wrap {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  display: flex;
  justify-content: center;
  margin-bottom: 10px;
}

.lwv-ann-canvas-stack {
  position: relative;
  display: inline-block;
  line-height: 0;
}

.lwv-ann-img {
  display: block;
  max-width: 100%;
  user-select: none;
  pointer-events: none;
}

.lwv-ann-canvas {
  position: absolute;
  inset: 0;
  cursor: crosshair;
}

.lwv-ann-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 12px;
  border-top: 1px solid var(--silo-color-border, rgba(128,128,128,0.2));
}

.lwv-ann-error {
  font-size: var(--silo-font-size-base, 13px);
  color: var(--silo-color-err, #e5484d);
}

.lwv-ann-btn {
  padding: 7px 16px;
  border-radius: var(--silo-radius-sm, 4px);
  border: 1px solid var(--silo-color-border-strong, rgba(128,128,128,0.35));
  background: transparent;
  color: var(--silo-color-text, currentColor);
  font-size: var(--silo-font-size-base, 13px);
  font-family: var(--silo-font-ui);
  cursor: pointer;
}

.lwv-ann-btn:hover {
  background: var(--silo-color-bg-hover, rgba(128,128,128,0.08));
}

.lwv-ann-btn-primary {
  background: var(--silo-color-accent, #4f8ef7);
  border-color: var(--silo-color-accent, #4f8ef7);
  color: #fff;
}

.lwv-ann-btn-primary:hover {
  opacity: 0.9;
  background: var(--silo-color-accent, #4f8ef7);
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
        params: { title: "Web View" },
      },
    });

    ctx.registerCommand({
      id: "silo.local-web-viewer.open",
      label: "Local Web Viewer: Open",
      run: () => ctx.layout.openPanel("local-web-viewer", { title: "Web View" }),
    });
  },
};
