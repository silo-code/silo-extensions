import { useEffect, useState } from "react";
import { useServiceState, type ExtensionContext, type SidePanelProps } from "@silo-code/sdk";
import { Plus } from "@phosphor-icons/react";
import { DocTree } from "./DocTree";

export interface DocsRoot {
  id: string;
  label: string;
  path: string;
}

type ExpandedMap = Record<string, boolean>;

export function DocsPanel({
  ctx,
  storage,
  hydrated,
}: SidePanelProps & { ctx: ExtensionContext }) {
  const wsState = useServiceState(ctx.workspaces);
  const ws = wsState.all.find((w) => w.id === wsState.activeId) ?? null;

  const [roots, setRoots] = useState<DocsRoot[]>(() =>
    storage.get<DocsRoot[]>("roots", []),
  );

  useEffect(() => {
    setRoots(storage.get<DocsRoot[]>("roots", []));
    return storage.subscribe(() =>
      setRoots(storage.get<DocsRoot[]>("roots", [])),
    );
  }, [storage, hydrated]);

  async function addRoot() {
    const folder = await ctx.ui.pickFolder();
    if (!folder) return;
    const label = folder.split("/").filter(Boolean).pop() ?? folder;
    storage.set("roots", [
      ...storage.get<DocsRoot[]>("roots", []),
      { id: crypto.randomUUID(), label, path: folder },
    ]);
  }

  function removeRoot(id: string) {
    storage.set("roots", roots.filter((r) => r.id !== id));
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
