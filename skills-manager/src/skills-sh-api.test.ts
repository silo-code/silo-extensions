import { describe, expect, it } from "vitest";
import {
  normalizeCatalogSkill,
  parseSkillsShPage,
  skillsShPageUrl,
} from "./skills-sh-api";

describe("skillsShPageUrl", () => {
  it("builds the public leaderboard URL", () => {
    expect(skillsShPageUrl("trending", 2)).toBe(
      "https://skills.sh/api/skills/trending/2",
    );
  });
});

describe("normalizeCatalogSkill", () => {
  it("accepts a well-formed row and drops junk", () => {
    expect(
      normalizeCatalogSkill({
        source: "vercel-labs/skills",
        skillId: "find-skills",
        name: "find-skills",
        installs: 100,
        weeklyInstalls: [1, 2, "x", 3],
        isOfficial: true,
      }),
    ).toEqual({
      source: "vercel-labs/skills",
      skillId: "find-skills",
      name: "find-skills",
      installs: 100,
      weeklyInstalls: [1, 2, 3],
      isOfficial: true,
    });
    expect(normalizeCatalogSkill({ skillId: "only" })).toBeNull();
  });

  it("falls back to skillId when name is missing", () => {
    expect(
      normalizeCatalogSkill({ source: "a/b", skillId: "x", installs: 1 }),
    ).toEqual({ source: "a/b", skillId: "x", name: "x", installs: 1 });
  });

  it("ignores wrong-typed optional fields", () => {
    expect(
      normalizeCatalogSkill({
        source: "a/b",
        skillId: "x",
        installs: "100",
        isOfficial: "yes",
        weeklyInstalls: "nope",
      }),
    ).toEqual({ source: "a/b", skillId: "x", name: "x", installs: 0 });
  });

  it("omits weeklyInstalls when every entry is invalid", () => {
    const result = normalizeCatalogSkill({
      source: "a/b",
      skillId: "x",
      installs: 1,
      weeklyInstalls: ["a", "b"],
    });
    expect(result).not.toHaveProperty("weeklyInstalls");
  });
});

describe("parseSkillsShPage", () => {
  it("parses a page and skips invalid entries", () => {
    const page = parseSkillsShPage(
      JSON.stringify({
        skills: [
          {
            source: "a/b",
            skillId: "one",
            name: "one",
            installs: 5,
          },
          { nope: true },
        ],
        page: 0,
        total: 99,
        hasMore: true,
      }),
      7,
    );
    expect(page.skills).toHaveLength(1);
    expect(page.page).toBe(0);
    expect(page.total).toBe(99);
    expect(page.hasMore).toBe(true);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseSkillsShPage("not-json", 0)).toThrow(/invalid JSON/);
  });

  it("throws on non-object JSON (a bare number)", () => {
    expect(() => parseSkillsShPage("42", 0)).toThrow(/non-object payload/);
  });

  it("treats a valid JSON array with no skills field as an empty page", () => {
    // Arrays are `typeof "object"` in JS, so this doesn't hit the
    // non-object-payload guard — it just has no `skills` array to read.
    const page = parseSkillsShPage(JSON.stringify([1, 2, 3]), 4);
    expect(page.skills).toEqual([]);
    expect(page.page).toBe(4);
  });

  it("defaults hasMore to false when absent", () => {
    const page = parseSkillsShPage(JSON.stringify({ skills: [], page: 0, total: 0 }), 0);
    expect(page.hasMore).toBe(false);
  });

  it("treats a missing skills array as empty and falls back to the given page", () => {
    const page = parseSkillsShPage(JSON.stringify({ total: 5 }), 3);
    expect(page.skills).toEqual([]);
    expect(page.page).toBe(3);
  });
});
