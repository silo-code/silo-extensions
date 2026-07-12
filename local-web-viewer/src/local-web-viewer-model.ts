/**
 * Pure helpers for the local-web-viewer panel — URL normalization and the
 * hostname-derived fallback title. Kept separate so the logic is
 * unit-testable without mounting a component.
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

