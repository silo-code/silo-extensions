/**
 * Relative-time formatting for the sheet's multiline row meta line (R15) —
 * "2h ago", "3d ago". No React, no `ctx`.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * `ms` is an epoch millisecond timestamp in the past (`Task.updatedAt`);
 * `now` defaults to the real clock but takes an explicit value for tests. A
 * non-positive or tiny diff (clock skew, "just saved") reads as "just now"
 * rather than a negative or "0m ago".
 */
export function formatRelativeTime(ms: number, now: number = Date.now()): string {
  const diff = now - ms;
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < WEEK) return `${Math.floor(diff / DAY)}d ago`;
  if (diff < MONTH) return `${Math.floor(diff / WEEK)}w ago`;
  if (diff < YEAR) return `${Math.floor(diff / MONTH)}mo ago`;
  return `${Math.floor(diff / YEAR)}y ago`;
}
