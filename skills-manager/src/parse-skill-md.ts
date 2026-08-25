/**
 * Parse the YAML-ish frontmatter block from a SKILL.md body. Only the fields
 * we surface in the panel are extracted — full YAML is out of scope.
 */

export interface SkillFrontmatter {
  name?: string;
  description?: string;
}

/**
 * Extract `name` / `description` from a leading `---` frontmatter fence.
 * Tolerates missing fence, Windows newlines, and multi-line description
 * values written as a single quoted/plain line.
 */
export function parseSkillFrontmatter(markdown: string): SkillFrontmatter {
  const text = markdown.replace(/^\uFEFF/, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return {};
  const block = match[1] ?? "";
  const out: SkillFrontmatter = {};
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith("#")) continue;
    const m = /^(name|description)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1] as "name" | "description";
    let value = (m[2] ?? "").trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) out[key] = value;
  }
  return out;
}
