/**
 * Load a skills.sh catalog skill's human summary without the authenticated
 * v1 API. Prefers the public registry item (`/r/…`), whose `description` is
 * the full SKILL.md frontmatter summary shown on the website — the HTML
 * `og:description` meta is truncated.
 */

import type { NetworkService } from "@silo-code/sdk";
import { skillsShUrl, type CatalogSkill } from "./skill-model";

/** Decode the small set of entities meta tags commonly use. */
export function decodeBasicEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/**
 * Pull `og:description` or `name=description` from an HTML document.
 * Attribute order varies; both `property`/`name` before `content` and the
 * reverse are accepted. Prefer {@link extractRegistryDescription} — meta
 * tags are often truncated for social cards.
 */
export function extractMetaDescription(html: string): string | null {
  const patterns = [
    /<meta\s+property=["']og:description["']\s+content=["']([^"']*)["'][^>]*>/i,
    /<meta\s+content=["']([^"']*)["']\s+property=["']og:description["'][^>]*>/i,
    /<meta\s+name=["']description["']\s+content=["']([^"']*)["'][^>]*>/i,
    /<meta\s+content=["']([^"']*)["']\s+name=["']description["'][^>]*>/i,
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    const raw = m?.[1]?.trim();
    if (raw) return decodeBasicEntities(raw);
  }
  return null;
}

/**
 * Read the full summary from a skills.sh registry item payload
 * (`GET /r/{source}/{skillId}`).
 */
export function extractRegistryDescription(body: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const description = (parsed as { description?: unknown }).description;
  if (typeof description !== "string") return null;
  const trimmed = description.trim();
  return trimmed || null;
}

/** Absolute skills.sh page URL (HTML). */
export function skillPageUrl(
  skill: Pick<CatalogSkill, "source" | "skillId">,
): string {
  return skillsShUrl(skill);
}

/** Absolute skills.sh registry-item URL (full summary JSON). */
export function skillRegistryUrl(
  skill: Pick<CatalogSkill, "source" | "skillId">,
): string {
  const sourcePath = skill.source
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `https://skills.sh/r/${sourcePath}/${encodeURIComponent(skill.skillId)}`;
}

/**
 * Fetch the full website summary for a skill. Tries the public registry item
 * first (untruncated frontmatter description), then falls back to HTML meta.
 * Returns `null` when neither source has a description.
 */
export async function fetchSkillDescription(
  net: Pick<NetworkService, "fetch">,
  skill: Pick<CatalogSkill, "source" | "skillId">,
): Promise<string | null> {
  const registryUrl = skillRegistryUrl(skill);
  try {
    const res = await net.fetch(registryUrl, {
      method: "GET",
      timeoutMs: 15_000,
      headers: { Accept: "application/json" },
    });
    if (res.status >= 200 && res.status < 300) {
      const fromRegistry = extractRegistryDescription(res.body);
      if (fromRegistry) return fromRegistry;
    }
  } catch {
    // Fall through to the HTML meta scrape.
  }

  const pageUrl = skillPageUrl(skill);
  const res = await net.fetch(pageUrl, {
    method: "GET",
    timeoutMs: 15_000,
    headers: { Accept: "text/html" },
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`skills.sh page HTTP ${res.status}`);
  }
  return extractMetaDescription(res.body);
}
