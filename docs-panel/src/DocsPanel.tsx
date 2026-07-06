import { useEffect, useState } from "react";
import { useServiceState, type ExtensionContext, type SidePanelProps } from "@silo-code/sdk";
import { Plus } from "@phosphor-icons/react";
import { DocTree } from "./DocTree";

/// Renders the markdown documentation side panel.
export interface DocsRoot {
  id: string;
  label: string;
  path: string;
}

type ExpandedMap = Record<string, boolean>;

// DocsPanel renders the markdown documentation side panel.
export function DocsPanel({
  ctx,
  storage,
}: SidePanelProps & { ctx: ExtensionContext }) {
  // Re-renders on workspace switch — the hook that makes storage.get() below
  // return the right workspace's data each time. Mirrors FileExplorerPanel.
  const wsState = useServiceState(ctx.workspaces);
  const ws = wsState.all.find((w) => w.id === wsState.activeId) ?? null;

  // Force a re-render when storage.set() is called within this panel so that
  // the storage.get() calls below pick up the change immediately.
  const [, tick] = useState(0);
  useEffect(() => {
    const sub = storage.subscribe(() => tick((n) => n + 1));
    return () => sub.dispose();
  }, [storage]);

  // Scope roots by workspace ID so each workspace has its own folder list.
  // storage may be shared across workspaces (global scope), so we namespace
  // manually — the same pattern used by the github-actions extension.
  const rootsKey = ws ? `roots:${ws.id}` : null;
  const roots = rootsKey ? storage.get<DocsRoot[]>(rootsKey, []) : [];

  async function addRoot() {
    if (!rootsKey) return;
    const folder = await ctx.ui.pickFolder();
    if (!folder) return;
    const label = folder.split("/").filter(Boolean).pop() ?? folder;
    storage.set(rootsKey, [
      ...storage.get<DocsRoot[]>(rootsKey, []),
      { id: crypto.randomUUID(), label, path: folder },
    ]);
  }

  function removeRoot(id: string) {
    if (!rootsKey) return;
    storage.set(rootsKey, storage.get<DocsRoot[]>(rootsKey, []).filter((r) => r.id !== id));
  }

  function persistExpanded(rootId: string, expanded: ExpandedMap) {
    storage.set(`expanded:${rootId}`, expanded);
  }

  function getExpanded(rootId: string): ExpandedMap {
    return storage.get<ExpandedMap>(`expanded:${rootId}`, {});
  }

  return (
    <div className="docs-panel">
      <div className="docs-scroll">
        {roots.length === 0 ? (
          <button className="docs-add-root-btn docs-add-root-btn--empty" onClick={addRoot}>
            <Plus size="0.9em" weight="bold" aria-hidden="true" />
            Add documentation folder…
          </button>
        ) : (
          roots.map((root) => (
            <DocTree
              key={root.id}
              ctx={ctx}
              workspaceId={ws?.id}
              rootPath={root.path}
              rootLabel={root.label}
              initialExpanded={getExpanded(root.id)}
              persistExpanded={(exp) => persistExpanded(root.id, exp)}
              onRemove={() => removeRoot(root.id)}
              onAdd={addRoot}
            />
          ))
        )}
      </div>
    </div>
  );
}
