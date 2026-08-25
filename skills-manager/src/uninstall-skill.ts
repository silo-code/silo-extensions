import type { ExtensionContext } from "@silo-code/sdk";
import { buildRemoveCommand, type SkillScope } from "./skill-model";
import { runConfirmedTerminalCommand } from "./terminal-command";

/** Persisted when the user checks "Don't show this again" on uninstall. */
export const UNINSTALL_SKILL_DONT_SHOW_KEY = "uninstallSkill.dontShowAgain";

/** Confirm copy for the uninstall dialog (exported for unit tests). */
export function buildUninstallConfirmBody(
  skillName: string,
  scope: SkillScope,
  command: string,
): string {
  const where =
    scope === "user" ? "your user skill folders" : "this workspace";
  return `Silo will open a terminal and run ${command} to remove "${skillName}" from ${where}.`;
}

/**
 * Confirm (with optional "don't show again"), then open a terminal and run the
 * skills CLI remove command. Cancel / dismiss leaves nothing spawned.
 */
export async function confirmAndUninstallSkill(
  ctx: ExtensionContext,
  opts: {
    skillId: string;
    skillName: string;
    scope: SkillScope;
    workspaceFolder: string | null;
    onUninstalled: () => void;
  },
): Promise<void> {
  const { skillId, skillName, scope, workspaceFolder, onUninstalled } = opts;
  const cmd = buildRemoveCommand(skillId, { scope });
  await runConfirmedTerminalCommand(ctx, {
    cmd,
    scope,
    workspaceFolder,
    confirm: {
      storageKey: UNINSTALL_SKILL_DONT_SHOW_KEY,
      title: "Uninstall skill?",
      body: buildUninstallConfirmBody(skillName, scope, cmd),
      confirmLabel: "Uninstall",
      mode: { kind: "confirm", danger: true },
    },
    busyNotify: `Uninstalling ${skillName} (${scope})…`,
    noTerminalError: "Could not open a terminal to uninstall the skill",
    onStarted: onUninstalled,
  });
}
