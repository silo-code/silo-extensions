/**
 * Public skills.sh leaderboard client (no auth).
 * `GET https://skills.sh/api/skills/{view}/{page}`
 */

import type { NetworkService } from "@silo-code/sdk";
import type { CatalogSkill, SkillsShView } from "./skill-model";

export const SKILLS_SH_API_BASE = "https://skills.sh/api/skills";

export interface SkillsShPage {
  skills: CatalogSkill[];
  page: number;
  total: number;
  hasMore: boolean;
}

interface RawSkill {
  source?: unknown;
  skillId?: unknown;
  name?: unknown;
  installs?: unknown;
  weeklyInstalls?: unknown;
  isOfficial?: unknown;
}

interface RawPage {
  skills?: unknown;
  page?: unknown;
  total?: unknown;
  hasMore?: unknown;
}

export function skillsShPageUrl(view: SkillsShView, page: number): string {
  return `${SKILLS_SH_API_BASE}/${view}/${page}`;
}

/** Normalize one API skill object; returns null when required fields are missing. */
export function normalizeCatalogSkill(raw: unknown): CatalogSkill | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as RawSkill;
  if (typeof r.source !== "string" || !r.source) return null;
  if (typeof r.skillId !== "string" || !r.skillId) return null;
  const name = typeof r.name === "string" && r.name ? r.name : r.skillId;
  const installs = typeof r.installs === "number" && Number.isFinite(r.installs)
    ? r.installs
    : 0;
  const weeklyInstalls = Array.isArray(r.weeklyInstalls)
    ? r.weeklyInstalls.filter((n): n is number => typeof n === "number")
    : undefined;
  const isOfficial = r.isOfficial === true ? true : undefined;
  return {
    source: r.source,
    skillId: r.skillId,
    name,
    installs,
    ...(weeklyInstalls && weeklyInstalls.length > 0
      ? { weeklyInstalls }
      : {}),
    ...(isOfficial ? { isOfficial: true } : {}),
  };
}

/** Parse a leaderboard page body; throws on non-object JSON. */
export function parseSkillsShPage(body: string, fallbackPage: number): SkillsShPage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    throw new Error("skills.sh returned invalid JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("skills.sh returned a non-object payload");
  }
  const raw = parsed as RawPage;
  const list = Array.isArray(raw.skills) ? raw.skills : [];
  const skills: CatalogSkill[] = [];
  for (const item of list) {
    const skill = normalizeCatalogSkill(item);
    if (skill) skills.push(skill);
  }
  return {
    skills,
    page: typeof raw.page === "number" ? raw.page : fallbackPage,
    total: typeof raw.total === "number" ? raw.total : skills.length,
    hasMore: raw.hasMore === true,
  };
}

/**
 * Fetch one leaderboard page. Uses `ctx.net` so the request bypasses CORS.
 */
export async function fetchSkillsShPage(
  net: Pick<NetworkService, "fetch">,
  view: SkillsShView,
  page: number,
): Promise<SkillsShPage> {
  const url = skillsShPageUrl(view, page);
  const res = await net.fetch(url, { method: "GET", timeoutMs: 20_000 });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`skills.sh HTTP ${res.status}`);
  }
  return parseSkillsShPage(res.body, page);
}

/**
 * Fetch pages `[0 .. maxPages)` (or until `hasMore` is false), de-duplicating
 * by `source/skillId`. Used to seed an offline-filterable browse cache.
 */
export async function fetchSkillsShPages(
  net: Pick<NetworkService, "fetch">,
  view: SkillsShView,
  maxPages: number,
): Promise<{ skills: CatalogSkill[]; total: number; hasMore: boolean; pagesFetched: number }> {
  const byKey = new Map<string, CatalogSkill>();
  let total = 0;
  let hasMore = false;
  let pagesFetched = 0;
  for (let page = 0; page < maxPages; page++) {
    const result = await fetchSkillsShPage(net, view, page);
    pagesFetched++;
    total = result.total;
    hasMore = result.hasMore;
    for (const skill of result.skills) {
      byKey.set(`${skill.source}/${skill.skillId}`, skill);
    }
    if (!result.hasMore) break;
  }
  return {
    skills: [...byKey.values()],
    total,
    hasMore,
    pagesFetched,
  };
}
