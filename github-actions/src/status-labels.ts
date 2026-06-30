import { type StatusBarState, type WorkspaceGhState, selectFailedRuns, selectRunningRuns } from "./store";
import { formatElapsed } from "./format-elapsed";

// Pure presentation helpers for the status bar item. Kept out of the component
// so they can be unit-tested without rendering.

export function getIconVariant(state: StatusBarState): "failed" | "dim" {
  switch (state.kind) {
    case "gh-missing":
    case "unauthenticated":
    case "api-error":
      return "failed";
    case "ok":
      return state.failed > 0 ? "failed" : "dim";
    default:
      return "dim";
  }
}

export function getLabel(state: StatusBarState): string {
  switch (state.kind) {
    case "gh-missing": return "Actions: cli missing";
    case "unauthenticated": return "Actions: Auth failed";
    case "api-error": return "Actions: Error";
    case "no-repo": return "Actions: No git repository";
    case "checking": return "Actions: Checking...";
    case "ok":
      if (state.failed > 0 && state.running > 0) return `Actions: ${state.failed} failed · ${state.running} running`;
      if (state.failed > 0) return `Actions: ${state.failed} failed`;
      if (state.running > 0) return `Actions: ${state.running} running`;
      return "Actions: ok";
    default: return "Actions";
  }
}

export function getTooltip(state: StatusBarState): string {
  switch (state.kind) {
    case "gh-missing": return "GitHub Actions: gh CLI not installed — click for setup";
    case "unauthenticated": return "GitHub Actions: gh CLI not authenticated — click for setup";
    case "api-error": return `GitHub Actions: ${state.message}`;
    case "no-repo": return "GitHub Actions: no git repository in this workspace";
    case "checking": return "GitHub Actions: checking...";
    case "ok": {
      const parts: string[] = [];
      if (state.failed > 0) parts.push(`${state.failed} failed`);
      if (state.running > 0) parts.push(`${state.running} running`);
      return parts.length ? `GitHub Actions: ${parts.join(", ")}` : "GitHub Actions: all clear";
    }
    default: return "GitHub Actions";
  }
}

/**
 * Richer tooltip for the SDK <Tooltip> component. When workspace state is
 * available (active ok workspace) it adds repo name, branch, individual
 * workflow names (up to 3), and the last-fetched time. Falls back to the
 * plain getTooltip string for non-ok states.
 */
export function getRichTooltip(
  state: StatusBarState,
  ws?: WorkspaceGhState,
  clearedAt?: Date,
): string {
  if (state.kind !== "ok") return getTooltip(state);

  const parts: string[] = [];

  parts.push(ws?.repoInfo
    ? `GitHub Actions — ${ws.repoInfo.owner}/${ws.repoInfo.repo}`
    : "GitHub Actions");

  if (ws?.branch) parts.push(ws.branch);

  if (state.failed > 0) {
    const names = ws
      ? [...new Set(selectFailedRuns(ws.runs, clearedAt).map((r) => r.name))]
      : [];
    if (names.length > 0) {
      const shown = names.slice(0, 3);
      const extra = names.length - shown.length;
      const nameStr = extra > 0 ? `${shown.join(", ")} +${extra} more` : shown.join(", ");
      parts.push(`${state.failed} failed: ${nameStr}`);
    } else {
      parts.push(`${state.failed} failed`);
    }
  }

  if (state.running > 0) {
    const names = ws
      ? [...new Set(selectRunningRuns(ws.runs).map((r) => r.name))]
      : [];
    if (names.length > 0) {
      const shown = names.slice(0, 3);
      const extra = names.length - shown.length;
      const nameStr = extra > 0 ? `${shown.join(", ")} +${extra} more` : shown.join(", ");
      parts.push(`${state.running} running: ${nameStr}`);
    } else {
      parts.push(`${state.running} running`);
    }
  }

  if (state.failed === 0 && state.running === 0) parts.push("All clear");

  if (ws?.lastFetched) parts.push(`Updated ${formatElapsed(ws.lastFetched)}`);

  return parts.join("  ·  ");
}
