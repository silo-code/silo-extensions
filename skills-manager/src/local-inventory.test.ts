import { describe, expect, it, beforeEach } from "vitest";
import { path } from "@silo-code/sdk";
import { scanInstalledSkills } from "./local-inventory";
import type { FileMeta } from "@silo-code/sdk";

function meta(
  abs: string,
  isDir: boolean,
): FileMeta {
  return {
    name: path.basename(abs),
    path: abs,
    isDir,
    size: isDir ? 0 : 12,
    modifiedMs: 0,
  };
}

describe("scanInstalledSkills", () => {
  const files = new Map<string, { isDir: boolean; body?: string }>();

  beforeEach(() => {
    files.clear();
  });

  function putDir(abs: string) {
    files.set(abs, { isDir: true });
  }
  function putFile(abs: string, body: string) {
    files.set(abs, { isDir: false, body });
  }

  const fs = {
    async stat(p: string) {
      const hit = files.get(p);
      if (!hit) return null;
      return meta(p, hit.isDir);
    },
    async readDir(p: string) {
      const prefix = p.endsWith("/") ? p : `${p}/`;
      const children: FileMeta[] = [];
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (!rest || rest.includes("/")) continue;
        const hit = files.get(key)!;
        children.push(meta(key, hit.isDir));
      }
      return children;
    },
    async readText(p: string) {
      const hit = files.get(p);
      if (!hit || hit.isDir || hit.body == null) throw new Error("missing");
      return hit.body;
    },
  };

  it("finds project and user skills and merges agent roots", async () => {
    putDir("/ws/.claude/skills");
    putDir("/ws/.claude/skills/grill-me");
    putFile(
      "/ws/.claude/skills/grill-me/SKILL.md",
      "---\nname: Grill Me\ndescription: Push back\n---\n",
    );
    putDir("/ws/.agents/skills");
    putDir("/ws/.agents/skills/grill-me");
    putFile(
      "/ws/.agents/skills/grill-me/SKILL.md",
      "---\nname: Grill Me\ndescription: Push back\n---\n",
    );

    putDir("/home/.cursor/skills");
    putDir("/home/.cursor/skills/frontend-design");
    putFile(
      "/home/.cursor/skills/frontend-design/SKILL.md",
      "---\nname: Frontend Design\n---\n",
    );

    const skills = await scanInstalledSkills({
      files: fs,
      workspaceFolder: "/ws",
      home: "/home",
    });

    expect(skills).toHaveLength(2);
    const project = skills.find((s) => s.id === "grill-me");
    expect(project?.scope).toBe("project");
    expect(project?.locations).toHaveLength(2);
    expect(project?.name).toBe("Grill Me");
    const user = skills.find((s) => s.id === "frontend-design");
    expect(user?.scope).toBe("user");
    expect(user?.locations[0]?.agent).toBe("cursor");
  });

  it("ignores missing roots", async () => {
    const skills = await scanInstalledSkills({
      files: fs,
      workspaceFolder: "/empty",
      home: null,
    });
    expect(skills).toEqual([]);
  });

  it("skips hidden directories under a skill root", async () => {
    putDir("/ws/.claude/skills");
    putDir("/ws/.claude/skills/grill-me");
    putFile(
      "/ws/.claude/skills/grill-me/SKILL.md",
      "---\nname: Grill Me\n---\n",
    );
    putDir("/ws/.claude/skills/.git");

    const skills = await scanInstalledSkills({
      files: fs,
      workspaceFolder: "/ws",
      home: null,
    });
    expect(skills.map((s) => s.id)).toEqual(["grill-me"]);
  });

  it("treats a SKILL.md directory as no frontmatter", async () => {
    putDir("/ws/.claude/skills");
    putDir("/ws/.claude/skills/foo");
    putDir("/ws/.claude/skills/foo/SKILL.md");

    const skills = await scanInstalledSkills({
      files: fs,
      workspaceFolder: "/ws",
      home: null,
    });
    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe("foo");
    expect(skills[0]?.locations[0]?.skillMdPath).toBeNull();
  });

  it("still counts the skill as installed when SKILL.md fails to read", async () => {
    putDir("/ws/.claude/skills");
    putDir("/ws/.claude/skills/foo");
    putFile("/ws/.claude/skills/foo/SKILL.md", "---\nname: Foo\n---\n");
    const fsThrowing = {
      ...fs,
      async readText(p: string) {
        if (p === "/ws/.claude/skills/foo/SKILL.md") {
          throw new Error("permission denied");
        }
        return fs.readText(p);
      },
    };

    const skills = await scanInstalledSkills({
      files: fsThrowing,
      workspaceFolder: "/ws",
      home: null,
    });
    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe("foo");
  });
});
