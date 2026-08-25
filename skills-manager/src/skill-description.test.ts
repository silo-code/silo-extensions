import { describe, expect, it } from "vitest";
import {
  decodeBasicEntities,
  extractMetaDescription,
  extractRegistryDescription,
  skillPageUrl,
  skillRegistryUrl,
} from "./skill-description";

describe("extractMetaDescription", () => {
  it("reads og:description", () => {
    const html = `<html><head>
<meta property="og:description" content="A relentless interview to sharpen a plan or design."/>
</head></html>`;
    expect(extractMetaDescription(html)).toBe(
      "A relentless interview to sharpen a plan or design.",
    );
  });

  it("reads name=description when og is absent, and decodes entities", () => {
    const html = `<meta name="description" content="Foo &amp; bar&#39;s plan"/>`;
    expect(extractMetaDescription(html)).toBe("Foo & bar's plan");
  });

  it("accepts content-before-property order", () => {
    const html = `<meta content="Hot skill" property="og:description" />`;
    expect(extractMetaDescription(html)).toBe("Hot skill");
  });

  it("returns null when missing", () => {
    expect(extractMetaDescription("<html></html>")).toBeNull();
  });

  it("returns null on malformed meta tags without throwing", () => {
    const html = `<meta property="og:description" content="unterminated`;
    expect(() => extractMetaDescription(html)).not.toThrow();
    expect(extractMetaDescription(html)).toBeNull();
  });
});

describe("extractRegistryDescription", () => {
  it("reads the full description field", () => {
    const body = JSON.stringify({
      name: "grill-me",
      description:
        "A relentless interview to sharpen a plan or design. Covers goals, constraints, and tradeoffs.",
    });
    expect(extractRegistryDescription(body)).toBe(
      "A relentless interview to sharpen a plan or design. Covers goals, constraints, and tradeoffs.",
    );
  });

  it("returns null for invalid JSON or missing description", () => {
    expect(extractRegistryDescription("not-json")).toBeNull();
    expect(extractRegistryDescription("{}")).toBeNull();
    expect(extractRegistryDescription('{"description":"  "}')).toBeNull();
  });

  it("returns null for non-object JSON", () => {
    expect(extractRegistryDescription(JSON.stringify([1, 2, 3]))).toBeNull();
    expect(extractRegistryDescription("42")).toBeNull();
  });

  it("returns null when description is not a string", () => {
    expect(
      extractRegistryDescription(JSON.stringify({ description: 42 })),
    ).toBeNull();
  });
});

describe("decodeBasicEntities", () => {
  it("round-trips the common set", () => {
    expect(decodeBasicEntities("a &amp; b")).toBe("a & b");
  });

  it("decodes quot/apos/lt/gt", () => {
    expect(
      decodeBasicEntities("&quot;a&quot; &apos;b&apos; &lt;c&gt;"),
    ).toBe(`"a" 'b' <c>`);
  });
});

describe("skill URLs", () => {
  it("matches the skills.sh detail and registry paths", () => {
    const skill = { source: "mattpocock/skills", skillId: "grill-me" };
    expect(skillPageUrl(skill)).toBe(
      "https://skills.sh/mattpocock/skills/grill-me",
    );
    expect(skillRegistryUrl(skill)).toBe(
      "https://skills.sh/r/mattpocock/skills/grill-me",
    );
  });
});
