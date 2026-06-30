// Formats a past instant as a short relative duration ("just now", "5m ago",
// "3h ago", "2d ago"). `now` is injectable so the logic is testable without
// freezing the clock.
export function formatElapsed(date: Date, now: number = Date.now()): string {
  const s = Math.floor((now - date.getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
