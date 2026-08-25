import type { ExtensionContext } from "@silo-code/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TERMINAL_SEND_DELAY_MS } from "./terminal-command";
import { buildRemoveCommand } from "./skill-model";
import {
  buildUninstallConfirmBody,
  confirmAndUninstallSkill,
  UNINSTALL_SKILL_DONT_SHOW_KEY,
} from "./uninstall-skill";

function makeCtx() {
  const create = vi.fn(() => ({ id: "term_1" }));
  const sendText = vi.fn();
  const focus = vi.fn();
  const getActive = vi.fn(() => null);
  const notify = vi.fn();
  const confirmWithDontShowAgain = vi.fn();
  return {
    ctx: {
      ui: { notify, confirmWithDontShowAgain },
      terminals: { create, sendText, focus, getActive },
    } as unknown as ExtensionContext,
    create,
    sendText,
    focus,
    notify,
  };
}

describe("buildUninstallConfirmBody", () => {
  it("names the workspace for project scope", () => {
    expect(
      buildUninstallConfirmBody("grill-me", "project", "npx skills remove x"),
    ).toContain("this workspace");
  });

  it("names user skill folders for user scope", () => {
    expect(
      buildUninstallConfirmBody("grill-me", "user", "npx skills remove x -g"),
    ).toContain("your user skill folders");
  });
});

describe("confirmAndUninstallSkill", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not open a terminal when the user cancels", async () => {
    const { ctx, create, sendText, notify } = makeCtx();
    vi.mocked(ctx.ui.confirmWithDontShowAgain).mockResolvedValue(false);
    const onUninstalled = vi.fn();

    await confirmAndUninstallSkill(ctx, {
      skillId: "grill-me",
      skillName: "Grill Me",
      scope: "project",
      workspaceFolder: "/ws",
      onUninstalled,
    });

    expect(create).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
    expect(onUninstalled).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("passes a danger confirm with the shared storage key", async () => {
    const { ctx } = makeCtx();
    vi.mocked(ctx.ui.confirmWithDontShowAgain).mockResolvedValue(false);

    await confirmAndUninstallSkill(ctx, {
      skillId: "grill-me",
      skillName: "Grill Me",
      scope: "project",
      workspaceFolder: "/ws",
      onUninstalled: vi.fn(),
    });

    expect(ctx.ui.confirmWithDontShowAgain).toHaveBeenCalledWith(
      expect.objectContaining({
        storageKey: UNINSTALL_SKILL_DONT_SHOW_KEY,
        title: "Uninstall skill?",
        confirmLabel: "Uninstall",
        mode: { kind: "confirm", danger: true },
        body: buildUninstallConfirmBody(
          "Grill Me",
          "project",
          buildRemoveCommand("grill-me", { scope: "project" }),
        ),
      }),
    );
  });

  it("opens a terminal and schedules the remove command after confirm", async () => {
    const { ctx, create, sendText, focus, notify } = makeCtx();
    vi.mocked(ctx.ui.confirmWithDontShowAgain).mockResolvedValue(true);
    const onUninstalled = vi.fn();
    const cmd = buildRemoveCommand("grill-me", { scope: "user" });

    await confirmAndUninstallSkill(ctx, {
      skillId: "grill-me",
      skillName: "Grill Me",
      scope: "user",
      workspaceFolder: "/ws",
      onUninstalled,
    });

    expect(create).toHaveBeenCalledWith({ cwd: "/ws" });
    expect(focus).toHaveBeenCalledWith("term_1");
    expect(sendText).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("info", "Uninstalling Grill Me (user)…");
    expect(onUninstalled).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(TERMINAL_SEND_DELAY_MS);
    expect(sendText).toHaveBeenCalledWith("term_1", cmd, true);
  });
});
