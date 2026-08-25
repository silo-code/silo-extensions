/**
 * Shared install/uninstall mechanism: confirm, then open (or reuse) a terminal
 * and run a `skills` CLI command in it. Both flows share one race-avoidance
 * protocol, so the logic lives here once instead of copy-pasted per direction.
 */

import type { ExtensionContext } from "@silo-code/sdk";
import { shellQuote, type SkillScope } from "./skill-model";

/** Delay after focus before sendText — the PTY mounts lazily after focus, and
 * sending text immediately races that mount: both spawn a session, input
 * lands on the hidden one, and the visible tab stays empty. */
export const TERMINAL_SEND_DELAY_MS = 700;

export interface RunConfirmedTerminalCommandOptions {
  /** The `npx skills add|remove …` command to run. */
  cmd: string;
  scope: SkillScope;
  workspaceFolder: string | null;
  confirm: {
    storageKey: string;
    title: string;
    body: string;
    confirmLabel: string;
    mode: { kind: "confirm"; danger?: boolean };
  };
  /** Notify shown once the terminal command has been scheduled. */
  busyNotify: string;
  /** Notify shown when no terminal could be created or reused. */
  noTerminalError: string;
  /** Called once the command has been scheduled (not once it finishes). */
  onStarted: () => void;
}

/**
 * Confirm (with optional "don't show again"), then open a terminal and run
 * `cmd`. Cancel / dismiss leaves nothing spawned.
 *
 * Project-scoped commands `cd` into `workspaceFolder` first when reusing an
 * existing terminal that wasn't created with that cwd (a fresh terminal
 * already starts there).
 */
export async function runConfirmedTerminalCommand(
  ctx: ExtensionContext,
  opts: RunConfirmedTerminalCommandOptions,
): Promise<void> {
  const { cmd, scope, workspaceFolder, confirm, busyNotify, noTerminalError, onStarted } =
    opts;
  const ok = await ctx.ui.confirmWithDontShowAgain(confirm);
  if (!ok) return;

  // Project installs must land in the workspace folder. User installs use
  // `-g` so cwd only needs to exist for the PTY to spawn.
  const cwd = workspaceFolder ?? undefined;
  const created = ctx.terminals.create({ cwd });
  const terminalId = created?.id ?? ctx.terminals.getActive();
  if (!terminalId) {
    ctx.ui.notify("error", noTerminalError);
    return;
  }
  // Reveal the tab first, then wait for its lazy PTY mount. sendText right
  // after create races that mount: both spawn a session, input lands on the
  // hidden one, and the visible tab stays empty.
  ctx.terminals.focus(terminalId);
  const needsCd = Boolean(cwd && !created && scope === "project");
  setTimeout(() => {
    if (needsCd && cwd) {
      ctx.terminals.sendText(terminalId, `cd ${shellQuote(cwd)}`, true);
    }
    ctx.terminals.sendText(terminalId, cmd, true);
  }, TERMINAL_SEND_DELAY_MS);
  ctx.ui.notify("info", busyNotify);
  onStarted();
}
