import { useCallback, useMemo, useSyncExternalStore } from "react";
import { CaretDown, CaretRight } from "@phosphor-icons/react";
import { useFocusGroup, type ExtensionStorage } from "@silo-code/sdk";
import type { IssueListItem } from "../github-issue-api";
import { FILTER_LABELS, filterIssues, type IssueFilter } from "../filters";
import { repoStateKey, type WorkspaceIssueState } from "../store";
import { IssueRow } from "./IssueRow";

export interface IssueListViewProps {
  storage: ExtensionStorage;
  repoStates: WorkspaceIssueState[];
  filter: IssueFilter;
  viewerLogin: string | null;
  /** False until the service finishes its first probe of this workspace's remotes. */
  workspaceReady: boolean;
  /** True while the service is fetching this workspace — suppresses "no results" flashes. */
  refreshing: boolean;
  onOpenIssue: (repoKey: string, number: number) => void;
}

interface FlatRow {
  key: string;
  repoKey: string;
  issue: IssueListItem;
}

type CollapsedMap = Record<string, boolean>;

const COLLAPSED_KEY = "collapsed";
const EMPTY_COLLAPSED: CollapsedMap = {};

function apiErrorMessage(state: WorkspaceIssueState): string | null {
  return state.error?.kind === "api-error" ? state.error.error.message : null;
}

function sectionRepoKey(state: WorkspaceIssueState): string {
  return repoStateKey(state.repoInfo!.owner, state.repoInfo!.repo);
}

export function IssueListView({
  storage,
  repoStates,
  filter,
  viewerLogin,
  workspaceReady,
  refreshing,
  onOpenIssue,
}: IssueListViewProps) {
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
        issues: filterIssues(state.openIssues, state.closedIssues, filter, viewerLogin),
        collapsed: multi && (collapsedMap[key] ?? false),
        errorMessage: apiErrorMessage(state),
      };
    });
  }, [withRepo, filter, viewerLogin, multi, collapsedMap]);

  const flat: FlatRow[] = useMemo(() => {
    const rows: FlatRow[] = [];
    for (const section of sections) {
      if (section.collapsed) continue;
      for (const issue of section.issues) {
        rows.push({
          key: `${section.repoKey}:${issue.number}`,
          repoKey: section.repoKey,
          issue,
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
      if (row) onOpenIssue(row.repoKey, row.issue.number);
    },
  });

  const totalVisible = flat.length;
  const anyIssues = sections.some((s) => s.issues.length > 0);
  const singleError = !multi ? sections[0]?.errorMessage : null;

  if (withRepo.length === 0) {
    if (!workspaceReady) {
      return null;
    }
    return (
      <div className="ghi-empty">
        <div className="ghi-empty__title">No repository detected</div>
        <div>This workspace doesn’t have a GitHub remote.</div>
      </div>
    );
  }

  // Assigned / authored filters need the viewer login; avoid flashing an
  // empty list before `gh api user` returns.
  if ((filter === "assigned" || filter === "authored") && viewerLogin === null) {
    return (
      <div className="ghi-empty">
        <div className="ghi-empty__title">Loading issues…</div>
      </div>
    );
  }

  if (!multi) {
    if (totalVisible === 0) {
      return (
        <>
          {singleError && <div className="ghi-error-banner">{singleError}</div>}
          {!refreshing && (
            <div className="ghi-empty">
              <div className="ghi-empty__title">No issues</div>
              <div>Nothing matches “{FILTER_LABELS[filter]}” right now.</div>
            </div>
          )}
        </>
      );
    }
    return (
      <>
        {singleError && <div className="ghi-error-banner">{singleError}</div>}
        <ul className="ghi-list" role="listbox" {...group.containerProps}>
          {flat.map((row, i) => (
            <li key={row.key} role="none">
              <IssueRow
                issue={row.issue}
                onOpen={() => onOpenIssue(row.repoKey, row.issue.number)}
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
      {!anyIssues && !refreshing && (
        <div className="ghi-empty">
          <div className="ghi-empty__title">No issues</div>
          <div>Nothing matches “{FILTER_LABELS[filter]}” right now.</div>
        </div>
      )}
      {sections.map(({ state, repoKey, label, issues, collapsed, errorMessage }) => (
        <section key={repoKey} className="ghi-repo">
          <button
            type="button"
            className="ghi-root-label"
            onClick={() => persistCollapsed(repoKey, !collapsed)}
            aria-expanded={!collapsed}
          >
            <span className="ghi-root-chev">
              {collapsed ? (
                <CaretRight size="0.85em" weight="bold" />
              ) : (
                <CaretDown size="0.85em" weight="bold" />
              )}
            </span>
            <span className="ghi-root-name">{label}</span>
          </button>
          {!collapsed && (
            <>
              {errorMessage && (
                <div className="ghi-error-banner ghi-error-banner--inline">{errorMessage}</div>
              )}
              {issues.length === 0 ? (
                refreshing ? null : (
                  <div className="ghi-repo__empty">No matching issues</div>
                )
              ) : (
                <ul className="ghi-list" role="listbox">
                  {issues.map((issue) => {
                    const key = `${repoKey}:${issue.number}`;
                    const index = flatIndex.get(key) ?? -1;
                    return (
                      <li key={key} role="none">
                        <IssueRow
                          issue={issue}
                          onOpen={() => onOpenIssue(repoKey, issue.number)}
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
