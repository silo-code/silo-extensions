import { useEffect, useMemo, useRef, useState } from "react";
import { useFocusGroup, type ExtensionContext } from "@silo-code/sdk";
import type { FileMeta } from "@silo-code/sdk";
import { flattenVisible, treeArrowNav } from "./tree-nav";
import { DirNode } from "./DocTreeNodes";
import type { Listing, RowFocusProps } from "./tree-types";

const MD_EXTS = [".md", ".mdx"] as const;
const PREVIEW_VIEW_TYPE = "silo.markdown-preview";

function isMarkdown(name: string): boolean {
  return MD_EXTS.some((ext) => name.endsWith(ext));
}

type ExpandedMap = Record<string, boolean>;

export function DocTree({
  ctx,
  workspaceId,
  rootPath,
  rootLabel,
  initialExpanded,
  persistExpanded,
  onRemove,
}: {
  ctx: ExtensionContext;
  workspaceId: string | undefined;
  rootPath: string;
  rootLabel: string;
  initialExpanded?: ExpandedMap;
  persistExpanded: (expanded: ExpandedMap) => void;
  onRemove: () => void;
}) {
  const files = ctx.files;
  const editors = ctx.editors;

  const [listings, setListings] = useState<Record<string, Listing>>({});
  const [expanded, setExpanded] = useState<ExpandedMap>(() => ({
    ...(initialExpanded ?? { [rootPath]: true }),
  }));
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const loadingRef = useRef<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);

  const flat = useMemo(
    () => flattenVisible(rootPath, listings, expanded),
    [rootPath, listings, expanded],
  );
  const indexOfPath = useMemo(() => {
    const m = new Map<string, number>();
    flat.forEach((n, i) => m.set(n.path, i));
    return m;
  }, [flat]);
  const selectedIndex = selected ? (indexOfPath.get(selected) ?? 0) : 0;

  const group = useFocusGroup({
    count: flat.length,
    start: selectedIndex,
    orientation: "vertical",
  });

  function handleRowKey(
    e: { key: string; preventDefault(): void },
    path: string,
    isDir: boolean,
  ): boolean {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const action = treeArrowNav({
        key: e.key,
        path,
        isDir,
        expanded,
        root: rootPath,
      });
      if (action?.kind === "expand") {
        setExpanded((prev) => {
          const next = { ...prev, [path]: true };
          persistExpanded(next);
          return next;
        });
        if (!listings[path]) load(path);
      } else if (action?.kind === "collapse") {
        setExpanded((prev) => {
          const next = { ...prev, [path]: false };
          persistExpanded(next);
          return next;
        });
      } else if (action?.kind === "focusParent") {
        const parentIdx = indexOfPath.get(action.path);
        if (parentIdx !== undefined) group.focusItem(parentIdx);
      }
      return true;
    }
    if (e.key === "Enter" && !isDir) {
      e.preventDefault();
      openFile(path);
      return true;
    }
    return false;
  }

  function getRowProps(path: string, isDir: boolean): RowFocusProps {
    const idx = indexOfPath.get(path);
    if (idx === undefined) return {};
    const gp = group.getItemProps(idx);
    return {
      ...gp,
      onFocus: () => {
        gp.onFocus();
        setSelected(path);
      },
      onKeyDown: (e) => {
        if (handleRowKey(e, path, isDir)) return;
        gp.onKeyDown(e);
      },
    };
  }

  async function load(path: string) {
    if (loadingRef.current.has(path)) return;
    loadingRef.current.add(path);
    try {
      const raw: FileMeta[] = await files.readDir(path);
      const entries = raw.filter(
        (e) => !e.name.startsWith(".") && (e.isDir || isMarkdown(e.name)),
      );
      setListings((prev) => ({ ...prev, [path]: { entries } }));
    } catch (err) {
      setListings((prev) => ({
        ...prev,
        [path]: { entries: [], error: String(err) },
      }));
    } finally {
      loadingRef.current.delete(path);
    }
  }

  useEffect(() => {
    load(rootPath);
    for (const [path, isExpanded] of Object.entries(expanded)) {
      if (isExpanded && path !== rootPath) load(path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootPath]);

  useEffect(() => {
    const sub = files.watch(rootPath, (evt) => {
      const dirs = new Set<string>();
      for (const p of evt.paths) {
        const idx = p.lastIndexOf("/");
        dirs.add(idx <= 0 ? "/" : p.slice(0, idx));
      }
      setListings((prev) => {
        const next = { ...prev };
        for (const d of dirs) {
          if (next[d]) delete next[d];
        }
        return next;
      });
      dirs.forEach((d) => {
        if (expandedRef.current[d] ?? d === rootPath) load(d);
      });
    });
    return () => sub.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootPath]);

  function toggle(path: string, isDir: boolean) {
    setSelected(path);
    if (!isDir) {
      openFile(path);
      return;
    }
    setExpanded((prev) => {
      const next = { ...prev, [path]: !prev[path] };
      persistExpanded(next);
      return next;
    });
    if (!listings[path]) load(path);
  }

  function openFile(path: string) {
    editors.open(path, {
      viewType: PREVIEW_VIEW_TYPE,
      preview: true,
      ...(workspaceId ? { workspaceId } : {}),
    });
  }

  function refresh() {
    setListings({});
    load(rootPath);
    for (const [path, isExpanded] of Object.entries(expanded)) {
      if (isExpanded) load(path);
    }
  }

  return (
    <div
      className="docs-tree"
      role="tree"
      aria-label={rootLabel}
      {...group.containerProps}
    >
      <DirNode
        getRowProps={getRowProps}
        path={rootPath}
        name={rootLabel}
        isRoot
        depth={0}
        expanded={expanded}
        listings={listings}
        onToggle={toggle}
        selected={selected}
        rootActions={{ onRemove, onRefresh: refresh }}
      />
    </div>
  );
}
