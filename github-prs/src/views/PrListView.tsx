import { useCallback, useMemo, useSyncExternalStore } from "react";
import { CaretDown, CaretRight } from "@phosphor-icons/react";
import { useFocusGroup, type ExtensionStorage } from "@silo-code/sdk";
import type { PrListItem } from "../github-pr-api";
import { FILTER_LABELS, filterPrs, type PrFilter } from "../filters";
import { repoStateKey, type WorkspacePrState } from "../store";
import { PrRow } from "./PrRow";

export interface PrListViewProps {
  storage: ExtensionStorage;
  repoStates: WorkspacePrState[];
  filter: PrFilter;
  viewerLogin: string | null;
  /** False until the service finishes its first probe of this workspace's remotes. */
  workspaceReady: boolean;
  onOpenPr: (repoKey: string, number: number) => void;
}

interface FlatRow {
  key: string;
  repoKey: string;
  pr: PrListItem;
}

type CollapsedMap = Record<string, boolean>;

const COLLAPSED_KEY = "collapsed";
const EMPTY_COLLAPSED: CollapsedMap = {};

function apiErrorMessage(state: WorkspacePrState): string | null {
  return state.error?.kind === "api-error" ? state.error.error.message : null;
}

function sectionRepoKey(state: WorkspacePrState): string {
  return repoStateKey(state.repoInfo!.owner, state.repoInfo!.repo);
}

export function PrListView({
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
    (key: string, value: boolean) => {
      storage.set(COLLAPSED_KEY, {
        ...storage.get<CollapsedMap>(COLLAPSED_KEY, EMPTY_COLLAPSED),
        [key]: value,
      });
    },
    [storage],
  );

  const sections = useMemo(() => {
    return withRepo.map((state) => {
      const key = sectionRepoKey(state);
      return {
        state,
        repoKey: key,
        label: key.toUpperCase(),
        prs: filterPrs(state.openPrs, state.mergedPrs, filter, viewerLogin),
        collapsed: multi && (collapsedMap[key] ?? false),
        errorMessage: apiErrorMessage(state),
      };
    });
  }, [withRepo, filter, viewerLogin, multi, collapsedMap]);

  const flat: FlatRow[] = useMemo(() => {
    const rows: FlatRow[] = [];
    for (const section of sections) {
      if (section.collapsed) continue;
      for (const pr of section.prs) {
        rows.push({
          key: `${section.repoKey}:${pr.number}`,
          repoKey: section.repoKey,
          pr,
        });
      }
    }
    return rows;
  }, [sections]);

  const flatIndex = useMemo(() => {
    const map = new Map<string, number>();
    flat.forEach((row, i) => map.set(row.key, i));
    return map;
  }, [flat]);

  const group = useFocusGroup({
    count: flat.length,
    orientation: "vertical",
    onActivate: (i) => {
      const row = flat[i];
      if (row) onOpenPr(row.repoKey, row.pr.number);
    },
  });

  const totalVisible = flat.length;
  const anyPrs = sections.some((s) => s.prs.length > 0);
  const singleError = !multi ? sections[0]?.errorMessage : null;

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

  if (!multi) {
    if (totalVisible === 0) {
      return (
        <>
          {singleError && <div className="ghpr-error-banner">{singleError}</div>}
          <div className="ghpr-empty">
            <div className="ghpr-empty__title">No pull requests</div>
            <div>Nothing matches “{FILTER_LABELS[filter]}” right now.</div>
          </div>
        </>
      );
    }
    return (
      <>
        {singleError && <div className="ghpr-error-banner">{singleError}</div>}
        <ul className="ghpr-list" role="listbox" {...group.containerProps}>
          {flat.map((row, i) => (
            <li key={row.key} role="none">
              <PrRow
                pr={row.pr}
                onOpen={() => onOpenPr(row.repoKey, row.pr.number)}
                focusProps={group.getItemProps(i)}
              />
            </li>
          ))}
        </ul>
      </>
    );
  }

  return (
    <div {...group.containerProps}>
      {!anyPrs && (
        <div className="ghpr-empty">
          <div className="ghpr-empty__title">No pull requests</div>
          <div>Nothing matches “{FILTER_LABELS[filter]}” right now.</div>
        </div>
      )}
      {sections.map(({ state, repoKey, label, prs, collapsed, errorMessage }) => (
        <section key={repoKey} className="ghpr-repo">
          <button
            type="button"
            className="ghpr-root-label"
            onClick={() => persistCollapsed(repoKey, !collapsed)}
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
            <>
              {errorMessage && (
                <div className="ghpr-error-banner ghpr-error-banner--inline">{errorMessage}</div>
              )}
              {prs.length === 0 ? (
                <div className="ghpr-repo__empty">No matching PRs</div>
              ) : (
                <ul className="ghpr-list" role="listbox">
                  {prs.map((pr) => {
                    const key = `${repoKey}:${pr.number}`;
                    const index = flatIndex.get(key) ?? -1;
                    return (
                      <li key={key} role="none">
                        <PrRow
                          pr={pr}
                          onOpen={() => onOpenPr(repoKey, pr.number)}
                          focusProps={index >= 0 ? group.getItemProps(index) : undefined}
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </section>
      ))}
    </div>
  );
}
