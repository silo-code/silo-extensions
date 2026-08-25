/**
 * Shared types and pure helpers for the Skills panel — local inventory rows,
 * skills.sh catalog entries, install-command construction, and display
 * formatting. Kept free of React / `ctx` so the rules are unit-testable.
 */

/** Where a skill is installed relative to the machine vs the open workspace. */
export type SkillScope = "project" | "user";

/** Agent skill-root this copy was found under. */
export type SkillAgent =
  | "agents"
  | "claude"
  | "cursor"
  | "codex"
  | "unknown";

/** One filesystem location for a local skill (agent root + absolute paths). */
export interface LocalSkillLocation {
  agent: SkillAgent;
  /** Absolute directory containing the skill (…/skills/<id>). */
  dirPath: string;
  /** Absolute path to SKILL.md when present. */
  skillMdPath: string | null;
}

/** A skill discovered on disk for the active workspace and/or user home. */
export interface LocalSkill {
  /** Folder name — stable id used to match the skills.sh catalog. */
  id: string;
  /** Display name from SKILL.md frontmatter, else the folder name. */
  name: string;
  description?: string;
  scope: SkillScope;
  locations: LocalSkillLocation[];
}

/** Leaderboard views exposed by the public skills.sh listing API. */
export type SkillsShView = "all-time" | "trending" | "hot";

/** One row from `GET /api/skills/{view}/{page}`. */
export interface CatalogSkill {
  source: string;
  skillId: string;
  name: string;
  installs: number;
  weeklyInstalls?: number[];
  isOfficial?: boolean;
}

/** A catalog skill annotated with whether it is already installed locally. */
export interface CatalogSkillRow extends CatalogSkill {
  installedScopes: SkillScope[];
}

/** Roots scanned under a workspace folder or `$HOME`. */
export const SKILL_ROOTS: ReadonlyArray<{
  rel: string;
  agent: SkillAgent;
}> = [
  { rel: ".agents/skills", agent: "agents" },
  { rel: ".claude/skills", agent: "claude" },
  { rel: ".cursor/skills", agent: "cursor" },
  { rel: ".codex/skills", agent: "codex" },
];

export function agentLabel(agent: SkillAgent): string {
  switch (agent) {
    case "agents":
      return "Agents";
    case "claude":
      return "Claude";
    case "cursor":
      return "Cursor";
    case "codex":
      return "Codex";
    default:
      return "Other";
  }
}

/** Compact install count for list rows (e.g. `3.1M`, `954K`, `12.4K`). */
export function formatInstalls(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1000) return String(Math.round(n));
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}K`;
  if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  return `${Math.round(n / 1_000_000)}M`;
}

/** skills.sh detail page for a catalog entry. */
export function skillsShUrl(skill: Pick<CatalogSkill, "source" | "skillId">): string {
  const sourcePath = skill.source
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `https://skills.sh/${sourcePath}/${encodeURIComponent(skill.skillId)}`;
}

/** Composite key identifying a catalog entry across paginated/cached loads. */
export function catalogKey(skill: Pick<CatalogSkill, "source" | "skillId">): string {
  return `${skill.source}/${skill.skillId}`;
}

/**
 * Build the non-interactive `npx skills add` command for a catalog skill.
 * GitHub `owner/repo` sources get `--skill`; well-known domains pass the
 * source alone (the CLI resolves them).
 *
 * Always passes `--agent '*'` so the CLI links into every agent skill root
 * we scan (`.agents/skills`, `.claude/skills`, …). Without it, `-y` installs
 * only into the auto-detected agent — often wrong or empty inside Silo's
 * terminal — and the panel never sees the skill.
 */
export function buildInstallCommand(
  skill: Pick<CatalogSkill, "source" | "skillId">,
  opts: { scope: SkillScope; yes?: boolean } = { scope: "project" },
): string {
  const parts = ["npx", "skills", "add", shellQuote(skill.source)];
  if (skill.source.includes("/")) {
    parts.push("--skill", shellQuote(skill.skillId));
  }
  if (opts.scope === "user") parts.push("-g");
  parts.push("--agent", shellQuote("*"));
  if (opts.yes !== false) parts.push("-y");
  return parts.join(" ");
}

/**
 * Build the non-interactive `npx skills remove` command for an installed skill
 * id. Omits `--agent` so the CLI cleans links from every agent root (its
 * default). User scope adds `-g`.
 */
export function buildRemoveCommand(
  skillId: string,
  opts: { scope: SkillScope; yes?: boolean } = { scope: "project" },
): string {
  const parts = ["npx", "skills", "remove", shellQuote(skillId)];
  if (opts.scope === "user") parts.push("-g");
  if (opts.yes !== false) parts.push("-y");
  return parts.join(" ");
}

/** One remove command for one scope an installed skill is present in. */
export interface UninstallCommand {
  scope: SkillScope;
  cmd: string;
  label: string;
}

/**
 * Build one remove command per scope a skill is installed in — used by the
 * detail page to show every applicable uninstall command at once.
 */
export function buildUninstallCommands(
  skill: Pick<CatalogSkillRow, "skillId" | "installedScopes">,
): UninstallCommand[] {
  return (["project", "user"] as const satisfies readonly SkillScope[])
    .filter((scope) => skill.installedScopes.includes(scope))
    .map((scope) => ({
      scope,
      cmd: buildRemoveCommand(skill.skillId, { scope }),
      label: scope === "project" ? "From project" : "From user scope (−g)",
    }));
}

/** Quote a token for a POSIX shell when it contains whitespace or specials. */
export function shellQuote(token: string): string {
  if (/^[A-Za-z0-9_./:@+=-]+$/.test(token)) return token;
  return `'${token.replace(/'/g, `'\\''`)}'`;
}

/** Case-insensitive substring match across id / name / description / source. */
export function matchesQuery(
  query: string,
  fields: Array<string | undefined>,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => (f ?? "").toLowerCase().includes(q));
}

/** Filter + stable-sort local skills for the panel list. */
export function filterLocalSkills(
  skills: readonly LocalSkill[],
  query: string,
): LocalSkill[] {
  const filtered = skills.filter((s) =>
    matchesQuery(query, [
      s.id,
      s.name,
      s.description,
      ...s.locations.map((l) => agentLabel(l.agent)),
    ]),
  );
  return [...filtered].sort((a, b) => {
    if (a.scope !== b.scope) return a.scope === "project" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

/** Annotate catalog rows with which local scopes already have that skill id. */
export function annotateCatalog(
  catalog: readonly CatalogSkill[],
  local: readonly LocalSkill[],
): CatalogSkillRow[] {
  const scopesById = new Map<string, Set<SkillScope>>();
  for (const s of local) {
    let set = scopesById.get(s.id);
    if (!set) {
      set = new Set();
      scopesById.set(s.id, set);
    }
    set.add(s.scope);
  }
  return catalog.map((c) => ({
    ...c,
    installedScopes: [...(scopesById.get(c.skillId) ?? [])],
  }));
}

/** Catalog list filter: everything loaded, or only already-installed rows. */
export type CatalogInstallFilter = "all" | "installed";

/** Filter catalog rows by query and optional installed-only constraint. */
export function filterCatalogSkills(
  rows: readonly CatalogSkillRow[],
  query: string,
  installFilter: CatalogInstallFilter = "all",
): CatalogSkillRow[] {
  return rows.filter((r) => {
    if (installFilter === "installed" && r.installedScopes.length === 0) {
      return false;
    }
    return matchesQuery(query, [r.skillId, r.name, r.source]);
  });
}

/** Quiet meta line — which agent skill-roots a skill is linked into.
 * Leading dots (`.agents`, `.claude`) echo the on-disk folder names. */
export function agentRootsLabel(skill: Pick<LocalSkill, "locations">): string {
  const roots = [
    ...new Set(
      skill.locations
        .map((l) => l.agent)
        .filter((a): a is Exclude<typeof a, "unknown"> => a !== "unknown"),
    ),
  ];
  return roots.map((a) => `.${a}`).join(" · ");
}

/** `file://` URL for an absolute filesystem path, for `ctx.ui.openExternal`. */
export function pathToFileUrl(abs: string): string {
  const normalized = abs.startsWith("/") ? abs : `/${abs}`;
  return `file://${encodeURI(normalized)}`;
}

/**
 * Merge skill directories that share an id within one scope (same skill linked
 * into multiple agent roots) into a single {@link LocalSkill}.
 */
export function mergeLocalSkills(entries: readonly LocalSkill[]): LocalSkill[] {
  const byKey = new Map<string, LocalSkill>();
  for (const entry of entries) {
    const key = `${entry.scope}::${entry.id}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        ...entry,
        locations: [...entry.locations],
      });
      continue;
    }
    for (const loc of entry.locations) {
      if (!existing.locations.some((l) => l.dirPath === loc.dirPath)) {
        existing.locations.push(loc);
      }
    }
    // Prefer a non-empty description / prettier name from any copy.
    if (!existing.description && entry.description) {
      existing.description = entry.description;
    }
    if (existing.name === existing.id && entry.name !== entry.id) {
      existing.name = entry.name;
    }
  }
  return [...byKey.values()];
}
