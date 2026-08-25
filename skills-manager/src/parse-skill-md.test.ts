import { describe, expect, it } from "vitest";
import { parseSkillFrontmatter } from "./parse-skill-md";

describe("parseSkillFrontmatter", () => {
  it("reads name and description from a standard fence", () => {
    const md = `---
name: grill-me
description: Pressure-test plans until they crack
---

# Grill me
`;
    expect(parseSkillFrontmatter(md)).toEqual({
      name: "grill-me",
      description: "Pressure-test plans until they crack",
    });
  });

  it("strips quotes and tolerates CRLF / BOM", () => {
    const md =
      "\uFEFF---\r\nname: \"Frontend Design\"\r\ndescription: 'Make it tasteful'\r\n---\r\n\r\nBody\r\n";
    expect(parseSkillFrontmatter(md)).toEqual({
      name: "Frontend Design",
      description: "Make it tasteful",
    });
  });

  it("returns empty when there is no frontmatter", () => {
    expect(parseSkillFrontmatter("# Just a heading\n")).toEqual({});
  });

  it("ignores comment lines inside the fence", () => {
    const md = `---
name: grill-me
# a comment line
description: Push back
---
`;
    expect(parseSkillFrontmatter(md)).toEqual({
      name: "grill-me",
      description: "Push back",
    });
  });

  it("drops keys with an empty value", () => {
    const md = `---
name:
description: foo
---
`;
    expect(parseSkillFrontmatter(md)).toEqual({ description: "foo" });
  });

  it("ignores keys other than name/description", () => {
    const md = `---
license: MIT
name: Foo
version: 2
description: Bar
---
`;
    expect(parseSkillFrontmatter(md)).toEqual({
      name: "Foo",
      description: "Bar",
    });
  });

  it("returns empty when the closing fence is missing", () => {
    const md = "---\nname: Orphan\n\n# heading\n";
    expect(parseSkillFrontmatter(md)).toEqual({});
  });

  it("leaves the value alone when quotes are mismatched", () => {
    const md = `---
name: "Foo'
---
`;
    expect(parseSkillFrontmatter(md)).toEqual({ name: "\"Foo'" });
  });
});
