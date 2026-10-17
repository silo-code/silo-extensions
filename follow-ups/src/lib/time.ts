/**
 * Compact elapsed-time formatting for a Navigator row's meta line.
 *
 * Matches the host's own `formatElapsed` vocabulary — the one the Workspaces
 * panel renders `WorkspaceStatusRow.startedAt` with, documented as
 * `"6h"`, `"2d"`, `"just now"` — so a follow-up's age reads the same here as
 * everywhere else in the app. Deliberately **not** `tasks`' "2h ago" form:
 * these rows are a dense two-line list, and the suffix buys nothing.
 *
 * Pure — no SDK import at all.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * `ms` is an epoch millisecond timestamp in the past; `now` defaults to the
 * real clock but takes an explicit value for tests.
 *
 * Returns `null` for `0` — the sentinel a mark migrated from the 0.2.x boolean
 * form carries, meaning "time genuinely unknown". The caller drops the age
 * from the meta line rather than printing an age measured from the epoch.
 *
 * A negative or sub-minute diff (clock skew, just marked) reads "just now".
 */
export function formatElapsed(ms: number, now: number = Date.now()): string | null {
  if (ms === 0) return null;
  const diff = now - ms;
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  return `${Math.floor(diff / DAY)}d`;
}
