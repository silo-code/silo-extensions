/**
 * Pure helpers for the local-web-viewer panel — URL normalization and title
 * fetching. Kept separate so the logic is unit-testable without mounting a
 * component.
 */

const SCHEME_RE = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//;

/**
 * Normalize a raw user-typed string into a navigable URL.
 * - Prepends `https://` when no scheme is present.
 * - Returns `null` for strings that are unparseable even after prepending.
 */
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = SCHEME_RE.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    new URL(withScheme);
    return withScheme;
  } catch {
    return null;
  }
}

/**
 * Derive a tab title from a URL for use when the page title is unavailable
 * (cross-origin load) or empty. Returns the hostname for http/https, the
 * filename for file://, or the full URL as a last resort.
 */
export function tabTitleFromUrl(url: string): string {
  try {
    const { protocol, hostname, pathname } = new URL(url);
    if (protocol === "file:") return pathname.split("/").pop() || pathname;
    return hostname;
  } catch {
    return url;
  }
}

/**
 * Returns true for URLs that are local to this machine — localhost variants
 * and file:// paths. We only attempt a server-side title fetch for these;
 * external sites often return WAF block pages to non-browser user-agents.
 */
export function isLocalUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol === "file:") return true;
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname.endsWith(".local")
    );
  } catch {
    return false;
  }
}

/**
 * Extract the `<title>` text from an HTML string. Returns `null` if absent or
 * empty — caller falls back to {@link tabTitleFromUrl}.
 */
export function parseTitleFromHtml(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match?.[1]?.trim() || null;
}

