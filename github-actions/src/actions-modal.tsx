import { useState, useEffect, useCallback } from "react";
import { ArrowClockwise, CopySimple } from "@phosphor-icons/react";
import type { ExtensionContext } from "@silo-code/sdk";
import type { GhActionsService } from "./gh-actions-service";
import type { WorkflowRun } from "./github-api";
import { ghStore } from "./store";

interface Props {
  ctx: ExtensionContext;
  service: GhActionsService;
  close: () => void;
}

export function ActionsModal({ ctx, service, close: _close }: Props) {
  const activeId = ctx.workspaces.getState().activeId ?? "";
  const [wsState, setWsState] = useState(() => ghStore.workspaces.get(activeId));
  const [clearedAt, setClearedAt] = useState(() => ghStore.getClearedAt(activeId));
  const [currentBranchOnly, setCurrentBranchOnly] = useState(() => ghStore.getWorkspaceCurrentBranchOnly(activeId));
  const [refreshing, setRefreshing] = useState(false);
  const [rerunning, setRerunning] = useState<Set<number>>(new Set());

  useEffect(() => {
    return ghStore.subscribe(() => {
      setWsState(ghStore.workspaces.get(activeId));
      setClearedAt(ghStore.getClearedAt(activeId));
      setCurrentBranchOnly(ghStore.getWorkspaceCurrentBranchOnly(activeId));
    });
  }, [activeId]);

  const handleRefresh = useCallback(async () => {
    ghStore.clearWorkspaceRuns(activeId);
    setRefreshing(true);
    await service.refreshActive();
    setRefreshing(false);
  }, [service, activeId]);

  const handleClearAlerts = useCallback(() => {
    service.clearAlerts(activeId);
  }, [service, activeId]);

  const handleToggleCurrentBranchOnly = useCallback(async (value: boolean) => {
    ghStore.setWorkspaceCurrentBranchOnly(activeId, value);
    ghStore.clearWorkspaceRuns(activeId);
    setRefreshing(true);
    await service.refreshActive();
    setRefreshing(false);
  }, [activeId, service]);

  const handleRerun = useCallback(
    async (run: WorkflowRun) => {
      const repo = wsState?.repoInfo;
      const ws = ctx.workspaces.get(activeId);
      if (!repo || !ws) return;
      setRerunning((prev) => new Set(prev).add(run.id));
      const result = await service.rerun(repo.owner, repo.repo, run.id, ws.folder);
      setRerunning((prev) => {
        const next = new Set(prev);
        next.delete(run.id);
        return next;
      });
      if (result.ok) {
        ctx.ui.notify("info", `Re-running: ${run.name}`);
        handleRefresh();
      } else {
        ctx.ui.notify("error", result.message ?? "Re-run failed");
      }
    },
    [ctx, wsState, handleRefresh],
  );

  if (!wsState || !wsState.repoInfo) {
    return (
      <div className="gha-modal">
        <div className="gha-empty">
          <div className="gha-empty__icon-wrap"><IconCheckCircle /></div>
          <div className="gha-empty__title">No repository detected</div>
          <div className="gha-empty__sub">This workspace doesn't have a GitHub remote.</div>
        </div>
      </div>
    );
  }

  const { owner, repo } = wsState.repoInfo;
  const currentBranch = wsState.branch;
  const repoUrl = `https://github.com/${owner}/${repo}/actions`;

  const failedRuns = wsState.runs
    .filter(
      (r) =>
        r.status === "completed" &&
        r.conclusion === "failure" &&
        (!clearedAt || new Date(r.created_at) > clearedAt),
    )
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const runningRuns = wsState.runs.filter(
    (r) => r.status === "in_progress" || r.status === "queued",
  );

  return (
    <div className="gha-modal">
      {/* ── Header ── */}
      <div className="gha-modal__header">
        <button
          className="gha-modal__repo-link"
          onClick={() => ctx.ui.openExternal(repoUrl)}
          title="Open on GitHub"
        >
          <IconGitHub className="gha-modal__github-icon" />
          <span className="gha-modal__repo-name">{owner}/{repo}</span>
          <IconExternalLink className="gha-modal__ext-icon" />
        </button>
        <div className="gha-modal__subrow">
          {currentBranch && (
            <span className="gha-modal__branch">
              <IconBranch />
              {currentBranch}
            </span>
          )}
          {wsState.lastFetched && (
            <span className="gha-modal__updated">Updated {formatElapsed(wsState.lastFetched)}</span>
          )}
          <button
            className={`gha-refresh-btn${refreshing ? " gha-refresh-btn--spinning" : ""}`}
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh"
            aria-label="Refresh workflows"
          >
            <ArrowClockwise size={14} weight="bold" />
          </button>
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div className="gha-modal__body">

      {/* ── Loading ── */}
      {refreshing && (
        <div className="gha-loading">Checking workflows…</div>
      )}

      {/* ── API error ── */}
      {!refreshing && wsState.error?.kind === "api-error" && (
        <div className="gha-error-banner">
          <IconWarn />
          {wsState.error.error.message}
        </div>
      )}

      {/* ── Failed section ── */}
      {!refreshing && failedRuns.length > 0 && (
        <section className="gha-section">
          <div className="gha-section__header">
            <span className="gha-section__dot gha-section__dot--failed" />
            <span className="gha-section__title">Failed</span>
            <span className="gha-section__count">{failedRuns.length}</span>
            <button className="gha-section__action" onClick={handleClearAlerts} title="Mark current failures as seen">
              Clear alerts
            </button>
          </div>
          <div className="gha-runs">
            {failedRuns.map((run) => (
              <RunCard
                key={run.id}
                run={run}
                ctx={ctx}
                variant="failed"
                showBranch={!currentBranchOnly && run.head_branch !== currentBranch}
                rerunning={rerunning.has(run.id)}
                onRerun={() => handleRerun(run)}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── Running section ── */}
      {!refreshing && runningRuns.length > 0 && (
        <section className="gha-section">
          <div className="gha-section__header">
            <span className="gha-section__dot gha-section__dot--running" />
            <span className="gha-section__title">Running</span>
            <span className="gha-section__count">{runningRuns.length}</span>
          </div>
          <div className="gha-runs">
            {runningRuns.map((run) => (
              <RunCard
                key={run.id}
                run={run}
                ctx={ctx}
                variant="running"
                showBranch={!currentBranchOnly && run.head_branch !== currentBranch}
                rerunning={false}
                onRerun={() => {}}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── All clear ── */}
      {!refreshing && failedRuns.length === 0 && runningRuns.length === 0 && (
        <div className="gha-empty">
          <div className="gha-empty__icon-wrap"><IconCheckCircle /></div>
          <div className="gha-empty__title">All workflows passing</div>
          <div className="gha-empty__sub">No failures or active runs on this repo.</div>
        </div>
      )}

      </div>

      {/* ── Footer ── */}
      <div className="gha-modal__footer">
        <label className="gha-modal__footer-toggle">
          <input
            type="checkbox"
            checked={currentBranchOnly}
            disabled={refreshing}
            onChange={(e) => handleToggleCurrentBranchOnly(e.target.checked)}
          />
          <span>Only monitor the checked-out branch</span>
        </label>
      </div>
    </div>
  );
}

// ─── Run card ─────────────────────────────────────────────────────────────────

interface RunCardProps {
  run: WorkflowRun;
  ctx: ExtensionContext;
  variant: "failed" | "running";
  showBranch: boolean;
  rerunning: boolean;
  onRerun: () => void;
}

function RunCard({ run, ctx, variant, showBranch, rerunning, onRerun }: RunCardProps) {
  const pr = run.pull_requests?.[0];
  const isFailed = variant === "failed";
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(run.html_url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className={`gha-run gha-run--${variant}`}>
      <div className={`gha-run__icon gha-run__icon--${variant}`}>
        {isFailed ? <IconXCircle /> : <IconSpinner spinning />}
      </div>
      <div className="gha-run__body">
        <div className="gha-run__title">
          <span className="gha-run__name">{run.name}</span>
          <span className="gha-run__num">#{run.run_number}</span>
        </div>
        <div className="gha-run__meta">
          {showBranch && (
            <>
              <span className="gha-run__branch-tag" title={run.head_branch}>{run.head_branch}</span>
              <span className="gha-run__sep">·</span>
            </>
          )}
          <span>{formatElapsed(new Date(run.updated_at))}</span>
          {pr && (
            <>
              <span className="gha-run__sep">·</span>
              <button
                className="gha-run__pr"
                onClick={() =>
                  ctx.ui.openExternal(
                    pr.url
                      .replace("api.github.com/repos", "github.com")
                      .replace("/pulls/", "/pull/"),
                  )
                }
              >
                PR #{pr.number}
              </button>
            </>
          )}
        </div>
      </div>
      <div className="gha-run__actions">
        <button className="gha-btn gha-btn--copy" onClick={handleCopy} title="Copy URL">
          <CopySimple size={13} weight={copied ? "fill" : "regular"} />
          {copied ? "Copied!" : "Copy"}
        </button>
        <button className="gha-btn gha-btn--view" onClick={() => ctx.ui.openExternal(run.html_url)} title="Open on GitHub">
          <IconExternalLink />
          View
        </button>
        {isFailed && (
          <button className="gha-btn gha-btn--rerun" onClick={onRerun} disabled={rerunning} title="Re-run failed jobs">
            <IconRefresh />
            {rerunning ? "Running…" : "Re-run"}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconGitHub({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function IconExternalLink({ className }: { className?: string }) {
  return (
    <svg className={className} width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M6 3H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M9 2h5v5M14 2 8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconBranch() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M5.75 1a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm.75 2.927A2.25 2.25 0 1 0 4.25 3.5v.677a3.25 3.25 0 0 0 2.668 3.195 1.75 1.75 0 0 1 1.332 1.7V9.5a2.25 2.25 0 1 0 1.5 0v-.428a3.25 3.25 0 0 0-2.668-3.195A1.75 1.75 0 0 1 5.75 4.18v-.253zM10.25 9a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5z" />
    </svg>
  );
}

function IconRefresh() {
  return <ArrowClockwise size={13} weight="bold" />;
}

function IconWarn() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M7.002 2.5 1.5 13.5h13L9 2.5a1.15 1.15 0 0 0-2 0Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8 6.5v3M8 11.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconXCircle() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="m5.5 5.5 5 5M10.5 5.5l-5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function IconSpinner({ spinning }: { spinning?: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden className={spinning ? "gha-spin" : ""}>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" strokeOpacity="0.25" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function IconCheckCircle() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden>
      <circle cx="18" cy="18" r="15" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.3" />
      <path d="m11 18 5 6 9-10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatElapsed(date: Date): string {
  const ms = Date.now() - date.getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
