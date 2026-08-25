import type { ExtensionContext } from "@silo-code/sdk";
import { buildInstallCommand, type CatalogSkill, type SkillScope } from "./skill-model";
import { runConfirmedTerminalCommand } from "./terminal-command";

/** Persisted when the user checks "Don't show this again" on install. */
export const INSTALL_SKILL_DONT_SHOW_KEY = "installSkill.dontShowAgain";

/** Confirm copy for the install dialog (exported for unit tests). */
export function buildInstallConfirmBody(
  skillName: string,
  scope: SkillScope,
  command: string,
): string {
  const where =
    scope === "user" ? "your user skill folders" : "this workspace";
  return `Silo will open a terminal and run ${command} to install "${skillName}" into ${where}.`;
}

/**
 * Confirm (with optional "don't show again"), then open a terminal and run the
 * skills.sh install command. Cancel / dismiss leaves nothing spawned.
 */
export async function confirmAndInstallSkill(
  ctx: ExtensionContext,
  opts: {
    skill: Pick<CatalogSkill, "name" | "source" | "skillId">;
    scope: SkillScope;
    workspaceFolder: string | null;
    onInstalled: () => void;
  },
): Promise<void> {
  const { skill, scope, workspaceFolder, onInstalled } = opts;
  const cmd = buildInstallCommand(skill, { scope });
  await runConfirmedTerminalCommand(ctx, {
    cmd,
    scope,
    workspaceFolder,
    confirm: {
      storageKey: INSTALL_SKILL_DONT_SHOW_KEY,
      title: "Install skill?",
      body: buildInstallConfirmBody(skill.name, scope, cmd),
      confirmLabel: "Install",
      mode: { kind: "confirm" },
    },
    busyNotify: `Installing ${skill.name} (${scope})…`,
    noTerminalError: "Could not open a terminal to install the skill",
    onStarted: onInstalled,
  });
}
