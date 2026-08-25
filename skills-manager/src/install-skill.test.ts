import type { ExtensionContext } from "@silo-code/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildInstallConfirmBody,
  confirmAndInstallSkill,
  INSTALL_SKILL_DONT_SHOW_KEY,
} from "./install-skill";
import { buildInstallCommand } from "./skill-model";
import { TERMINAL_SEND_DELAY_MS } from "./terminal-command";

const skill = {
  name: "ai-avatar-video",
  source: "prime-skills/runcomfy-agent-skills",
  skillId: "ai-avatar-video",
};

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

describe("buildInstallConfirmBody", () => {
  it("names the workspace for project scope", () => {
    expect(
      buildInstallConfirmBody("ai-avatar-video", "project", "npx skills add x"),
    ).toContain("this workspace");
  });

  it("names user skill folders for user scope", () => {
    expect(
      buildInstallConfirmBody("ai-avatar-video", "user", "npx skills add x -g"),
    ).toContain("your user skill folders");
  });

  it("includes the command and skill name", () => {
    const body = buildInstallConfirmBody(
      "ai-avatar-video",
      "project",
      "npx skills add repo --skill ai-avatar-video",
    );
    expect(body).toContain("ai-avatar-video");
    expect(body).toContain("npx skills add repo --skill ai-avatar-video");
  });
});

describe("confirmAndInstallSkill", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not open a terminal when the user cancels", async () => {
    const { ctx, create, sendText, notify } = makeCtx();
    vi.mocked(ctx.ui.confirmWithDontShowAgain).mockResolvedValue(false);
    const onInstalled = vi.fn();

    await confirmAndInstallSkill(ctx, {
      skill,
      scope: "project",
      workspaceFolder: "/ws",
      onInstalled,
    });

    expect(create).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
    expect(onInstalled).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("passes the shared dont-show storage key and confirm mode", async () => {
    const { ctx } = makeCtx();
    vi.mocked(ctx.ui.confirmWithDontShowAgain).mockResolvedValue(false);

    await confirmAndInstallSkill(ctx, {
      skill,
      scope: "project",
      workspaceFolder: "/ws",
      onInstalled: vi.fn(),
    });

    expect(ctx.ui.confirmWithDontShowAgain).toHaveBeenCalledWith(
      expect.objectContaining({
        storageKey: INSTALL_SKILL_DONT_SHOW_KEY,
        title: "Install skill?",
        confirmLabel: "Install",
        mode: { kind: "confirm" },
        body: buildInstallConfirmBody(
          skill.name,
          "project",
          buildInstallCommand(skill, { scope: "project" }),
        ),
      }),
    );
  });

  it("opens a terminal and schedules the install command after confirm", async () => {
    const { ctx, create, sendText, focus, notify } = makeCtx();
    vi.mocked(ctx.ui.confirmWithDontShowAgain).mockResolvedValue(true);
    const onInstalled = vi.fn();
    const cmd = buildInstallCommand(skill, { scope: "project" });

    await confirmAndInstallSkill(ctx, {
      skill,
      scope: "project",
      workspaceFolder: "/ws",
      onInstalled,
    });

    expect(create).toHaveBeenCalledWith({ cwd: "/ws" });
    expect(focus).toHaveBeenCalledWith("term_1");
    expect(sendText).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("info", "Installing ai-avatar-video (project)…");
    expect(onInstalled).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(TERMINAL_SEND_DELAY_MS);
    expect(sendText).toHaveBeenCalledWith("term_1", cmd, true);
  });
});
