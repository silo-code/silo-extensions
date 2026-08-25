/**
 * Scan workspace + user skill roots for installed Agent Skills.
 * Uses host-mediated `readDir` / `readText` / `stat` — never raw fs.
 */

import { path, type FileService } from "@silo-code/sdk";
import { parseSkillFrontmatter } from "./parse-skill-md";
import {
  SKILL_ROOTS,
  mergeLocalSkills,
  type LocalSkill,
  type LocalSkillLocation,
  type SkillScope,
} from "./skill-model";

export interface ScanSkillsInput {
  files: Pick<FileService, "readDir" | "readText" | "stat">;
  /** Absolute path of the active workspace folder (project scope). */
  workspaceFolder: string | null;
  /** Absolute `$HOME` for user-scope roots. */
  home: string | null;
}

/**
 * Discover installed skills under project and user agent skill roots.
 * Missing roots are ignored; I/O errors on a single root do not fail the scan.
 * Project/user scopes, each root within a scope, and each skill directory's
 * stat+read are all independent, so every level scans in parallel.
 */
export async function scanInstalledSkills(
  input: ScanSkillsInput,
): Promise<LocalSkill[]> {
  const [project, user] = await Promise.all([
    input.workspaceFolder
      ? scanScope(input.files, input.workspaceFolder, "project")
      : Promise.resolve([]),
    input.home
      ? scanScope(input.files, input.home, "user")
      : Promise.resolve([]),
  ]);
  return mergeLocalSkills([...project, ...user]);
}

async function scanScope(
  files: ScanSkillsInput["files"],
  base: string,
  scope: SkillScope,
): Promise<LocalSkill[]> {
  const perRoot = await Promise.all(
    SKILL_ROOTS.map((root) => scanRoot(files, base, root, scope)),
  );
  return perRoot.flat();
}

async function scanRoot(
  files: ScanSkillsInput["files"],
  base: string,
  root: (typeof SKILL_ROOTS)[number],
  scope: SkillScope,
): Promise<LocalSkill[]> {
  const rootPath = path.join(base, root.rel);
  let entries;
  try {
    const st = await files.stat(rootPath);
    if (!st?.isDir) return [];
    entries = await files.readDir(rootPath);
  } catch {
    return [];
  }
  return Promise.all(
    entries
      // Skip hidden / tooling dirs that aren't skills.
      .filter((entry) => entry.isDir && !entry.name.startsWith("."))
      .map(async (entry): Promise<LocalSkill> => {
        const dirPath = entry.path;
        const skillMdPath = path.join(dirPath, "SKILL.md");
        let name = entry.name;
        let description: string | undefined;
        let resolvedMd: string | null = null;
        try {
          const mdStat = await files.stat(skillMdPath);
          if (mdStat && !mdStat.isDir) {
            resolvedMd = skillMdPath;
            const body = await files.readText(skillMdPath);
            const fm = parseSkillFrontmatter(body);
            if (fm.name) name = fm.name;
            if (fm.description) description = fm.description;
          }
        } catch {
          // Directory without a readable SKILL.md still counts as installed.
        }
        const location: LocalSkillLocation = {
          agent: root.agent,
          dirPath,
          skillMdPath: resolvedMd,
        };
        return {
          id: entry.name,
          name,
          description,
          scope,
          locations: [location],
        };
      }),
  );
}
