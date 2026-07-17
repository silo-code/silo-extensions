import { useCallback, useMemo, useSyncExternalStore } from "react";
import { CaretDown, CaretRight } from "@phosphor-icons/react";
import {
  useFocusGroup,
  type ExtensionContext,
  type ExtensionStorage,
} from "@silo-code/sdk";
import type { PrListItem } from "../github-pr-api";
import { FILTER_LABELS, filterPrs, type PrFilter } from "../filters";
import type { WorkspacePrState } from "../store";
import { PrRow } from "./PrRow";

export interface PrListViewProps {
  ctx: ExtensionContext;
  storage: ExtensionStorage;
  repoStates: WorkspacePrState[];
  filter: PrFilter;
  viewerLogin: string | null;
  /** False until the service finishes its first probe of this workspace's folders. */
  workspaceReady: boolean;
  onOpenPr: (folder: string, number: number) => void;
}

interface FlatRow {
  key: string;
  folder: string;
  pr: PrListItem;
}

type CollapsedMap = Record<string, boolean>;

const COLLAPSED_KEY = "collapsed";
const EMPTY_COLLAPSED: CollapsedMap = {};

function rootName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

export function PrListView({
  ctx: _ctx,
  storage,
  repoStates,
  filter,
  viewerLogin,
  workspaceReady,
  onOpenPr,
}: PrListViewProps) {
  const withRepo = useMemo(
    () => repoStates.filter((s) => s.repoInfo !== null),
    [repoStates],
  );
  const multi = withRepo.length > 1;

  const collapsedMap = useSyncExternalStore(
    useCallback((cb) => storage.subscribe(cb).dispose, [storage]),
    useCallback(
      () => storage.get<CollapsedMap>(COLLAPSED_KEY, EMPTY_COLLAPSED),
      [storage],
    ),
  );

  const persistCollapsed = useCallback(
    (folder: string, value: boolean) => {
      storage.set(COLLAPSED_KEY, {
        ...storage.get<CollapsedMap>(COLLAPSED_KEY, EMPTY_COLLAPSED),
        [folder]: value,
      });
    },
    [storage],
  );

  const sections = useMemo(() => {
    return withRepo.map((state) => ({
      state,
      label: rootName(state.folder).toUpperCase(),
      prs: filterPrs(state.openPrs, state.mergedPrs, filter, viewerLogin),
      collapsed: multi && (collapsedMap[state.folder] ?? false),
    }));
  }, [withRepo, filter, viewerLogin, multi, collapsedMap]);

  // Focusable rows are only the visible (non-collapsed) PR rows.
  const flat: FlatRow[] = useMemo(() => {
    const rows: FlatRow[] = [];
    for (const section of sections) {
      if (section.collapsed) continue;
      for (const pr of section.prs) {
        rows.push({
          key: `${section.state.folder}:${pr.number}`,
          folder: section.state.folder,
          pr,
        });
      }
    }
    return rows;
  }, [sections]);

  const group = useFocusGroup({
    count: flat.length,
    orientation: "vertical",
    onActivate: (i) => {
      const row = flat[i];
      if (row) onOpenPr(row.folder, row.pr.number);
    },
  });

  const apiError = withRepo.find((s) => s.error?.kind === "api-error");
  const totalVisible = flat.length;
  const anyPrs = sections.some((s) => s.prs.length > 0);

  if (withRepo.length === 0) {
    if (!workspaceReady) {
      return (
        <div className="ghpr-empty">
          <div className="ghpr-empty__title">Loading pull requests…</div>
          <div>Detecting GitHub remotes in this workspace.</div>
        </div>
      );
    }
    return (
      <div className="ghpr-empty">
        <div className="ghpr-empty__title">No repository detected</div>
        <div>This workspace doesn’t have a GitHub remote.</div>
      </div>
    );
  }

  // Authored / review-requested filters need the viewer login; avoid flashing an
  // empty list before `gh api user` returns.
  if (
    (filter === "authored" || filter === "review-requested") &&
    viewerLogin === null
  ) {
    return (
      <div className="ghpr-empty">
        <div className="ghpr-empty__title">Loading pull requests…</div>
      </div>
    );
  }

  // Single-repo: flat list, no root header (matches git panel).
  if (!multi) {
    if (totalVisible === 0) {
      return (
        <div className="ghpr-list-wrap">
          {apiError?.error?.kind === "api-error" && (
            <div className="ghpr-error-banner">{apiError.error.error.message}</div>
          )}
          <div className="ghpr-empty">
            <div className="ghpr-empty__title">No pull requests</div>
            <div>Nothing matches “{FILTER_LABELS[filter]}” right now.</div>
          </div>
        </div>
      );
    }
    return (
      <div className="ghpr-list-wrap">
        {apiError?.error?.kind === "api-error" && (
          <div className="ghpr-error-banner">{apiError.error.error.message}</div>
        )}
        <ul className="ghpr-list" role="listbox" {...group.containerProps}>
          {flat.map((row, i) => (
            <li key={row.key} role="none">
              <PrRow
                pr={row.pr}
                onOpen={() => onOpenPr(row.folder, row.pr.number)}
                focusProps={group.getItemProps(i)}
              />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="ghpr-list-wrap" {...group.containerProps}>
      {apiError?.error?.kind === "api-error" && (
        <div className="ghpr-error-banner">{apiError.error.error.message}</div>
      )}
      {!anyPrs && (
        <div className="ghpr-empty">
          <div className="ghpr-empty__title">No pull requests</div>
          <div>Nothing matches “{FILTER_LABELS[filter]}” right now.</div>
        </div>
      )}
      {sections.map(({ state, label, prs, collapsed }) => (
        <section key={state.folder} className="ghpr-repo">
          <button
            type="button"
            className="ghpr-root-label"
            onClick={() => persistCollapsed(state.folder, !collapsed)}
            aria-expanded={!collapsed}
          >
            <span className="ghpr-root-chev">
              {collapsed ? (
                <CaretRight size="0.85em" weight="bold" />
              ) : (
                <CaretDown size="0.85em" weight="bold" />
              )}
            </span>
            <span className="ghpr-root-name">{label}</span>
          </button>
          {!collapsed && (
            prs.length === 0 ? (
              <div className="ghpr-repo__empty">No matching PRs</div>
            ) : (
              <ul className="ghpr-list" role="listbox">
                {prs.map((pr) => {
                  const index = flat.findIndex(
                    (r) => r.folder === state.folder && r.pr.number === pr.number,
                  );
                  return (
                    <li key={`${state.folder}:${pr.number}`} role="none">
                      <PrRow
                        pr={pr}
                        onOpen={() => onOpenPr(state.folder, pr.number)}
                        focusProps={index >= 0 ? group.getItemProps(index) : undefined}
                      />
                    </li>
                  );
                })}
              </ul>
            )
          )}
        </section>
      ))}
    </div>
  );
}
