import type { Extension, SidePanelProps } from "@silo-code/sdk";
import { DocsPanel } from "./DocsPanel";

/* -------------------------------------------------------------------------- */
/* Styles. Runtime-loaded extensions must inject their own <style> — the host  */
/* only imports the JS bundle. Use --silo-* design tokens only so the panel    */
/* themes correctly and scales with uiFontSize.                                */
/* -------------------------------------------------------------------------- */

const STYLE_ID = "silo-docs-panel-styles";

const STYLES = `
.docs-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.docs-scroll {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

/* Empty-state prompt */
.docs-add-root-btn--empty {
  display: flex;
  align-items: center;
  gap: 0.4em;
  background: none;
  border: none;
  cursor: pointer;
  font-family: var(--silo-font-ui);
  font-size: calc(1em - 1px);
  color: var(--silo-color-text-lo);
  padding: 16px 12px;
  text-align: left;
  line-height: 1.6;
}
.docs-add-root-btn--empty:hover {
  color: var(--silo-color-text-hi);
}

/* ── Tree ─────────────────────────────────────────────────────────────────── */

.docs-tree {
  font-family: var(--silo-font-ui);
  padding: 4px 4px 0;
  user-select: none;
  line-height: 1.4;
}

.docs-tree:last-child {
  flex: 1 0 auto;
}

.docs-tree + .docs-tree {
  border-top: 1px solid var(--silo-color-border);
}

/* ── Tree rows ────────────────────────────────────────────────────────────── */

.docs-tree-row {
  display: flex;
  align-items: center;
  gap: 0.3em;
  padding: 2px 8px 3px 0;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--silo-color-text);
  min-height: calc(1.85em - 4px);
  border-radius: 3px;
  outline: none;
}
.docs-tree-row:hover {
  background: var(--silo-color-bg-hover);
}
.docs-tree-row.selected {
  background: var(--silo-color-bg-active);
}
.docs-tree-row.selected:hover {
  background: var(--silo-color-bg-active);
}

.docs-tree-row.root {
  font-size: calc(1em - 2px);
  letter-spacing: 0.04em;
  color: var(--silo-color-text-hi);
  font-weight: 700;
}

.docs-tree-row.empty-dir {
  color: var(--silo-color-text-lo);
  font-style: italic;
  cursor: default;
}
.docs-tree-row.empty-dir:hover {
  background: none;
}

.docs-tree-row .chev {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.2em;
  flex: 0 0 1.2em;
  color: var(--silo-color-text-lo);
}
.docs-tree-row.file .chev {
  visibility: hidden;
}
.docs-tree-row .ico {
  flex: 0 0 1.25em;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--silo-color-text);
}
.docs-tree-row .silo-tooltip-host {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  margin-left: calc(0.4em - 4px);
}

.docs-tree-row .name {
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
}

.docs-tree-row.error {
  color: var(--silo-color-err);
  padding: 4px 8px;
}

/* ── Root header action buttons ─────────────────────────────────────────── */

.docs-root-actions {
  display: flex;
  align-items: center;
  gap: 1px;
  margin-left: auto;
  padding-right: 4px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.1s;
}
.docs-panel:hover .docs-root-actions {
  opacity: 1;
  pointer-events: auto;
}
.docs-root-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--silo-color-text-hi);
  padding: 3px 4px;
  border-radius: var(--silo-radius-sm);
  line-height: 1;
  font-size: 1.2em;
  opacity: 0.7;
  transition: opacity 0.1s, background 0.1s;
}
.docs-root-actions button:hover {
  opacity: 1;
  background: var(--silo-color-bg-hover);
}

/* ── Children container ─────────────────────────────────────────────────── */

.docs-children {
  position: relative;
}
.docs-indent-guide {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--silo-color-border);
  opacity: 0.7;
  pointer-events: none;
}
`;

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = STYLES;
  document.head.appendChild(el);
}

function removeStyles(): void {
  document.getElementById(STYLE_ID)?.remove();
}

/* -------------------------------------------------------------------------- */
/* Extension entry point                                                       */
/* -------------------------------------------------------------------------- */

export const extension: Extension = {
  id: "silo.docs-panel",
  activate(ctx) {
    injectStyles();
    ctx.registerSidePanel({
      id: "docs",
      location: "right",
      title: "Docs",
      order: 20,
      lazyMount: true,
      component: (props: SidePanelProps) => (
        <DocsPanel ctx={ctx} {...props} />
      ),
    });
  },
  deactivate() {
    removeStyles();
  },
};
