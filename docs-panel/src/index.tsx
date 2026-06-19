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

.docs-panel-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 2px 6px;
  flex-shrink: 0;
}

.docs-panel-toolbar-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--silo-color-text-muted);
  padding: 3px 4px;
  border-radius: var(--silo-radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}
.docs-panel-toolbar-btn:hover {
  color: var(--silo-color-text);
  background: var(--silo-color-hover);
}

.docs-scroll {
  flex: 1;
  overflow-y: auto;
}

.docs-empty {
  padding: 16px 12px;
  color: var(--silo-color-text-muted);
  font-size: var(--silo-font-size-sm);
  line-height: 1.6;
}

/* ── Tree rows ────────────────────────────────────────────────────────────── */

.docs-tree {
  padding-bottom: 4px;
}

.docs-tree-row {
  display: flex;
  align-items: center;
  gap: 3px;
  cursor: pointer;
  user-select: none;
  padding-top: 2px;
  padding-bottom: 2px;
  padding-right: 8px;
  font-size: var(--silo-font-size-sm);
  color: var(--silo-color-text);
  min-height: 22px;
  outline: none;
}
.docs-tree-row:hover {
  background: var(--silo-color-hover);
}
.docs-tree-row.selected {
  background: var(--silo-color-selection);
}
.docs-tree-row[data-focus-visible] {
  outline: 2px solid var(--silo-color-focus-ring, var(--silo-color-border));
  outline-offset: -2px;
  border-radius: var(--silo-radius-sm);
}

.docs-tree-row.root {
  font-weight: 600;
  font-size: var(--silo-font-size-xs);
  letter-spacing: 0.05em;
  color: var(--silo-color-text-muted);
  padding-top: 4px;
  margin-top: 2px;
}

.docs-tree-row.empty-dir {
  color: var(--silo-color-text-muted);
  font-size: var(--silo-font-size-xs);
  font-style: italic;
  cursor: default;
}
.docs-tree-row.empty-dir:hover {
  background: none;
}

.docs-tree-row .chev {
  width: 16px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--silo-color-text-muted);
}
.docs-tree-row .ico {
  flex-shrink: 0;
  color: var(--silo-color-text-muted);
}
.docs-tree-row .name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Root header action buttons ─────────────────────────────────────────── */

.docs-root-actions {
  display: flex;
  gap: 1px;
  margin-left: auto;
  flex-shrink: 0;
}
.docs-root-actions button {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--silo-color-text-muted);
  padding: 2px 3px;
  border-radius: var(--silo-radius-sm);
  display: flex;
  align-items: center;
  line-height: 1;
  opacity: 0;
  transition: opacity 0.1s;
}
.docs-tree-row.root:hover .docs-root-actions button,
.docs-tree-row.root:focus-within .docs-root-actions button {
  opacity: 1;
}
.docs-root-actions button:hover {
  color: var(--silo-color-text);
  background: var(--silo-color-hover);
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
