import { useRef } from "react";
import {
  CaretRight,
  CaretDown,
  Folder,
  FolderOpen,
  File as FileIcon,
  ArrowClockwise,
  X,
  Plus,
} from "@phosphor-icons/react";
import {
  rowIndent,
  ROW_INDENT_PX,
  ROW_BASE_PX,
  type Listing,
  type RowFocusProps,
} from "./tree-types";
import type { FocusGroupItemProps } from "@silo-code/sdk";

interface RowSharedProps {
  getRowProps: (path: string, isDir: boolean) => RowFocusProps;
  selected: string | null;
}

export function DirNode({
  getRowProps,
  path,
  name,
  depth,
  isRoot = false,
  expanded,
  listings,
  onToggle,
  selected,
  rootActions,
}: {
  path: string;
  name: string;
  depth: number;
  isRoot?: boolean;
  expanded: Record<string, boolean>;
  listings: Record<string, Listing>;
  onToggle: (path: string, isDir: boolean) => void;
  rootActions?: { onAdd: () => void; onRemove: () => void; onRefresh: () => void };
} & RowSharedProps) {
  const isExpanded = !!expanded[path];
  const listing = listings[path];
  const isSelected = !isRoot && selected === path;

  const focusProps = getRowProps(path, true);
  const focusRef = (focusProps as Partial<FocusGroupItemProps>).ref;
  const setRef = (el: HTMLDivElement | null) => focusRef?.(el);

  return (
    <>
      <div
        {...(focusProps as React.HTMLAttributes<HTMLDivElement>)}
        ref={setRef}
        className={`docs-tree-row dir ${isRoot ? "root" : ""} ${isSelected ? "selected" : ""}`}
        style={rowIndent(depth)}
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={isExpanded}
        aria-selected={isSelected || undefined}
        onClick={() => onToggle(path, true)}
        title={path}
      >
        <span className="chev">
          {isExpanded ? (
            <CaretDown size="1.15em" weight="bold" aria-hidden="true" />
          ) : (
            <CaretRight size="1.15em" weight="bold" aria-hidden="true" />
          )}
        </span>
        {!isRoot &&
          (isExpanded ? (
            <FolderOpen size="1.3em" weight="regular" aria-hidden="true" className="ico" />
          ) : (
            <Folder size="1.3em" weight="regular" aria-hidden="true" className="ico" />
          ))}
        <span className="name">{isRoot ? name.toUpperCase() : name}</span>
        {isRoot && rootActions && (
          <span
            className="docs-root-actions"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              tabIndex={-1}
              title="Add folder"
              onClick={rootActions.onAdd}
            >
              <Plus size="1.1em" weight="bold" />
            </button>
            <button
              tabIndex={-1}
              title="Refresh"
              onClick={rootActions.onRefresh}
            >
              <ArrowClockwise size="1.1em" weight="regular" />
            </button>
            <button
              tabIndex={-1}
              title="Remove folder"
              onClick={rootActions.onRemove}
            >
              <X size="1.1em" weight="bold" />
            </button>
          </span>
        )}
      </div>
      {isExpanded && (
        <div className="docs-children" role="group">
          {!isRoot && (
            <span
              className="docs-indent-guide"
              style={{ left: `${ROW_BASE_PX + depth * ROW_INDENT_PX + 6}px` }}
            />
          )}
          {listing?.error && (
            <div className="docs-tree-row error" style={rowIndent(depth + 1)}>
              {listing.error}
            </div>
          )}
          {listing?.entries.map((entry) =>
            entry.isDir ? (
              <DirNode
                key={entry.path}
                getRowProps={getRowProps}
                path={entry.path}
                name={entry.name}
                depth={depth + 1}
                expanded={expanded}
                listings={listings}
                onToggle={onToggle}
                selected={selected}
              />
            ) : (
              <FileLeaf
                key={entry.path}
                getRowProps={getRowProps}
                path={entry.path}
                name={entry.name}
                depth={depth + 1}
                onOpen={onToggle}
                selected={selected}
              />
            ),
          )}
          {listing && !listing.error && listing.entries.length === 0 && (
            <div className="docs-tree-row empty-dir" style={rowIndent(depth + 1)}>
              No markdown files
            </div>
          )}
        </div>
      )}
    </>
  );
}

export function FileLeaf({
  getRowProps,
  path,
  name,
  depth,
  onOpen,
  selected,
}: {
  path: string;
  name: string;
  depth: number;
  onOpen: (path: string, isDir: boolean) => void;
} & RowSharedProps) {
  const isSelected = selected === path;

  const focusProps = getRowProps(path, false);
  const focusRef = (focusProps as Partial<FocusGroupItemProps>).ref;
  const setRef = (el: HTMLDivElement | null) => focusRef?.(el);

  return (
    <div
      {...(focusProps as React.HTMLAttributes<HTMLDivElement>)}
      ref={setRef}
      className={`docs-tree-row file ${isSelected ? "selected" : ""}`}
      style={rowIndent(depth)}
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={isSelected || undefined}
      onClick={() => onOpen(path, false)}
      title={path}
    >
      <span className="chev" />
      <FileIcon size="1.3em" weight="regular" aria-hidden="true" className="ico" />
      <span className="name">{name.replace(/\.mdx?$/, "")}</span>
    </div>
  );
}
