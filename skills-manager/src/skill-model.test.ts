import { describe, expect, it } from "vitest";
import {
  agentRootsLabel,
  annotateCatalog,
  buildInstallCommand,
  buildRemoveCommand,
  buildUninstallCommands,
  catalogKey,
  filterCatalogSkills,
  filterLocalSkills,
  formatInstalls,
  matchesQuery,
  mergeLocalSkills,
  shellQuote,
  skillsShUrl,
  type CatalogSkill,
  type LocalSkill,
} from "./skill-model";

const local = (partial: Partial<LocalSkill> & Pick<LocalSkill, "id">): LocalSkill => ({
  name: partial.name ?? partial.id,
  scope: partial.scope ?? "project",
  locations: partial.locations ?? [
    {
      agent: "claude",
      dirPath: `/ws/.claude/skills/${partial.id}`,
      skillMdPath: `/ws/.claude/skills/${partial.id}/SKILL.md`,
    },
  ],
  description: partial.description,
  id: partial.id,
});

describe("formatInstalls", () => {
  it("formats small and large counts", () => {
    expect(formatInstalls(42)).toBe("42");
    expect(formatInstalls(1500)).toBe("1.5K");
    expect(formatInstalls(954_709)).toBe("955K");
    expect(formatInstalls(3_090_818)).toBe("3.1M");
    expect(formatInstalls(12_000_000)).toBe("12M");
  });

  it("formats exact scale boundaries", () => {
    expect(formatInstalls(1000)).toBe("1K");
    expect(formatInstalls(10_000)).toBe("10K");
    expect(formatInstalls(1_000_000)).toBe("1M");
    expect(formatInstalls(10_000_000)).toBe("10M");
  });

  it("treats negative or non-finite input as zero", () => {
    expect(formatInstalls(-5)).toBe("0");
    expect(formatInstalls(NaN)).toBe("0");
    expect(formatInstalls(Infinity)).toBe("0");
  });
});

describe("buildInstallCommand", () => {
  it("builds a project-scoped GitHub install for all agents", () => {
    expect(
      buildInstallCommand(
        { source: "mattpocock/skills", skillId: "grill-me" },
        { scope: "project" },
      ),
    ).toBe("npx skills add mattpocock/skills --skill grill-me --agent '*' -y");
  });

  it("adds -g for user scope", () => {
    expect(
      buildInstallCommand(
        { source: "vercel-labs/skills", skillId: "find-skills" },
        { scope: "user" },
      ),
    ).toContain(" -g ");
  });

  it("skips --skill for well-known domain sources", () => {
    expect(
      buildInstallCommand(
        { source: "open.feishu.cn", skillId: "lark-doc" },
        { scope: "project" },
      ),
    ).toBe("npx skills add open.feishu.cn --agent '*' -y");
  });

  it("omits -y when yes is false", () => {
    expect(
      buildInstallCommand(
        { source: "mattpocock/skills", skillId: "grill-me" },
        { scope: "project", yes: false },
      ),
    ).not.toContain("-y");
  });

  it("quotes a skillId containing a space", () => {
    expect(
      buildInstallCommand(
        { source: "mattpocock/skills", skillId: "my skill" },
        { scope: "project" },
      ),
    ).toBe("npx skills add mattpocock/skills --skill 'my skill' --agent '*' -y");
  });
});

describe("shellQuote", () => {
  it("leaves safe tokens alone and quotes the rest", () => {
    expect(shellQuote("a/b")).toBe("a/b");
    expect(shellQuote("has space")).toBe("'has space'");
  });

  it("escapes an embedded single quote", () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });

  it("quotes an empty string", () => {
    expect(shellQuote("")).toBe("''");
  });
});

describe("skillsShUrl", () => {
  it("builds a detail URL", () => {
    expect(
      skillsShUrl({ source: "mattpocock/skills", skillId: "grill-me" }),
    ).toBe("https://skills.sh/mattpocock/skills/grill-me");
  });
});

describe("matchesQuery", () => {
  it("is case-insensitive", () => {
    expect(matchesQuery("FRONT", ["frontend"])).toBe(true);
  });

  it("returns false when nothing matches", () => {
    expect(matchesQuery("zzz", ["frontend", "design"])).toBe(false);
  });

  it("treats undefined fields as non-matching, not throwing", () => {
    expect(matchesQuery("y", [undefined, "y"])).toBe(true);
    expect(matchesQuery("x", [undefined])).toBe(false);
  });

  it("matches everything for an empty/whitespace query", () => {
    expect(matchesQuery("  ", ["anything"])).toBe(true);
  });
});

describe("filterLocalSkills", () => {
  it("filters by name and sorts project before user", () => {
    const skills = [
      local({ id: "zeta", scope: "user" }),
      local({ id: "alpha", scope: "project", description: "frontend polish" }),
      local({ id: "beta", scope: "project" }),
    ];
    const filtered = filterLocalSkills(skills, "front");
    expect(filtered.map((s) => s.id)).toEqual(["alpha"]);
    expect(filterLocalSkills(skills, "").map((s) => s.id)).toEqual([
      "alpha",
      "beta",
      "zeta",
    ]);
  });
});


describe("buildRemoveCommand", () => {
  it("removes a project skill non-interactively", () => {
    expect(buildRemoveCommand("grill-me", { scope: "project" })).toBe(
      "npx skills remove grill-me -y",
    );
  });

  it("adds -g for user scope", () => {
    expect(buildRemoveCommand("grill-me", { scope: "user" })).toBe(
      "npx skills remove grill-me -g -y",
    );
  });

  it("quotes skill ids that need it", () => {
    expect(buildRemoveCommand("my skill", { scope: "project" })).toBe(
      "npx skills remove 'my skill' -y",
    );
  });
});

describe("annotateCatalog + filterCatalogSkills", () => {
  const catalog: CatalogSkill[] = [
    {
      source: "mattpocock/skills",
      skillId: "grill-me",
      name: "grill-me",
      installs: 10,
    },
    {
      source: "vercel-labs/skills",
      skillId: "find-skills",
      name: "find-skills",
      installs: 20,
      isOfficial: true,
    },
  ];

  it("marks installed scopes and filters", () => {
    const rows = annotateCatalog(catalog, [
      local({ id: "grill-me", scope: "project" }),
      local({ id: "grill-me", scope: "user" }),
    ]);
    expect(rows[0]?.installedScopes.sort()).toEqual(["project", "user"]);
    expect(rows[1]?.installedScopes).toEqual([]);
    expect(filterCatalogSkills(rows, "find").map((r) => r.skillId)).toEqual([
      "find-skills",
    ]);
    expect(
      filterCatalogSkills(rows, "", "installed").map((r) => r.skillId),
    ).toEqual(["grill-me"]);
    expect(filterCatalogSkills(rows, "find", "installed")).toEqual([]);
  });

  it("matches case-insensitively", () => {
    const rows = annotateCatalog(catalog, []);
    expect(filterCatalogSkills(rows, "FIND").map((r) => r.skillId)).toEqual([
      "find-skills",
    ]);
  });
});

describe("mergeLocalSkills", () => {
  it("merges the same id across agent roots in one scope", () => {
    const merged = mergeLocalSkills([
      local({
        id: "grill-me",
        locations: [
          {
            agent: "claude",
            dirPath: "/ws/.claude/skills/grill-me",
            skillMdPath: "/ws/.claude/skills/grill-me/SKILL.md",
          },
        ],
      }),
      local({
        id: "grill-me",
        name: "Grill Me",
        description: "Pressure-test a plan",
        locations: [
          {
            agent: "agents",
            dirPath: "/ws/.agents/skills/grill-me",
            skillMdPath: null,
          },
        ],
      }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.locations).toHaveLength(2);
    expect(merged[0]?.name).toBe("Grill Me");
    expect(merged[0]?.description).toBe("Pressure-test a plan");
  });

  it("returns empty for empty input", () => {
    expect(mergeLocalSkills([])).toEqual([]);
  });

  it("returns a single entry unchanged", () => {
    const entry = local({ id: "grill-me" });
    const merged = mergeLocalSkills([entry]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual(entry);
  });

  it("keeps the first entry's name/description when it already has data", () => {
    const merged = mergeLocalSkills([
      local({
        id: "grill-me",
        name: "Grill Me",
        description: "Pressure-test a plan",
        locations: [
          {
            agent: "claude",
            dirPath: "/ws/.claude/skills/grill-me",
            skillMdPath: "/ws/.claude/skills/grill-me/SKILL.md",
          },
        ],
      }),
      local({
        id: "grill-me",
        name: "Interrogate",
        description: "A different summary",
        locations: [
          {
            agent: "agents",
            dirPath: "/ws/.agents/skills/grill-me",
            skillMdPath: null,
          },
        ],
      }),
    ]);
    expect(merged[0]?.name).toBe("Grill Me");
    expect(merged[0]?.description).toBe("Pressure-test a plan");
  });
});

describe("catalogKey", () => {
  it("joins source and skillId", () => {
    expect(catalogKey({ source: "mattpocock/skills", skillId: "grill-me" })).toBe(
      "mattpocock/skills/grill-me",
    );
  });
});

describe("buildUninstallCommands", () => {
  it("returns one command per installed scope", () => {
    const cmds = buildUninstallCommands({
      skillId: "grill-me",
      installedScopes: ["project", "user"],
    });
    expect(cmds).toEqual([
      { scope: "project", cmd: "npx skills remove grill-me -y", label: "From project" },
      {
        scope: "user",
        cmd: "npx skills remove grill-me -g -y",
        label: "From user scope (−g)",
      },
    ]);
  });

  it("returns an empty list when not installed anywhere", () => {
    expect(
      buildUninstallCommands({ skillId: "grill-me", installedScopes: [] }),
    ).toEqual([]);
  });
});

describe("agentRootsLabel", () => {
  it("dedupes and joins known agent roots", () => {
    const label = agentRootsLabel({
      locations: [
        { agent: "claude", dirPath: "/a", skillMdPath: null },
        { agent: "claude", dirPath: "/b", skillMdPath: null },
        { agent: "agents", dirPath: "/c", skillMdPath: null },
      ],
    });
    expect(label).toBe(".claude · .agents");
  });

  it("drops unknown agents and returns empty for none", () => {
    expect(
      agentRootsLabel({
        locations: [{ agent: "unknown", dirPath: "/a", skillMdPath: null }],
      }),
    ).toBe("");
  });
});
