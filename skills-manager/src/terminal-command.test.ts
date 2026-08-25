import type { ExtensionContext } from "@silo-code/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runConfirmedTerminalCommand,
  TERMINAL_SEND_DELAY_MS,
} from "./terminal-command";

function makeCtx(overrides?: {
  createId?: string | null;
  activeId?: string | null;
}) {
  const create = vi.fn(() =>
    overrides?.createId === null
      ? undefined
      : { id: overrides?.createId ?? "term_1" },
  );
  const sendText = vi.fn();
  const focus = vi.fn();
  const getActive = vi.fn(() => overrides?.activeId ?? null);
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
    getActive,
    notify,
  };
}

const baseConfirm = {
  storageKey: "test.dontShowAgain",
  title: "Run command?",
  body: "Runs a thing.",
  confirmLabel: "Run",
  mode: { kind: "confirm" as const },
};

describe("runConfirmedTerminalCommand", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does nothing when the user cancels", async () => {
    const { ctx, create, sendText, notify } = makeCtx();
    vi.mocked(ctx.ui.confirmWithDontShowAgain).mockResolvedValue(false);
    const onStarted = vi.fn();

    await runConfirmedTerminalCommand(ctx, {
      cmd: "npx skills add x -y",
      scope: "project",
      workspaceFolder: "/ws",
      confirm: baseConfirm,
      busyNotify: "Running…",
      noTerminalError: "No terminal",
      onStarted,
    });

    expect(create).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(onStarted).not.toHaveBeenCalled();
  });

  it("runs the command in a freshly created terminal without cd", async () => {
    const { ctx, create, sendText, focus, notify } = makeCtx();
    vi.mocked(ctx.ui.confirmWithDontShowAgain).mockResolvedValue(true);
    const onStarted = vi.fn();

    await runConfirmedTerminalCommand(ctx, {
      cmd: "npx skills add x -y",
      scope: "project",
      workspaceFolder: "/ws",
      confirm: baseConfirm,
      busyNotify: "Running…",
      noTerminalError: "No terminal",
      onStarted,
    });

    expect(create).toHaveBeenCalledWith({ cwd: "/ws" });
    expect(focus).toHaveBeenCalledWith("term_1");
    expect(notify).toHaveBeenCalledWith("info", "Running…");
    expect(onStarted).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(TERMINAL_SEND_DELAY_MS);
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("term_1", "npx skills add x -y", true);
  });

  it("falls back to the active terminal and cd's in when create() returns nothing", async () => {
    const { ctx, sendText, focus } = makeCtx({
      createId: null,
      activeId: "term_active",
    });
    vi.mocked(ctx.ui.confirmWithDontShowAgain).mockResolvedValue(true);

    await runConfirmedTerminalCommand(ctx, {
      cmd: "npx skills add x -y",
      scope: "project",
      workspaceFolder: "/ws",
      confirm: baseConfirm,
      busyNotify: "Running…",
      noTerminalError: "No terminal",
      onStarted: vi.fn(),
    });

    expect(focus).toHaveBeenCalledWith("term_active");
    await vi.advanceTimersByTimeAsync(TERMINAL_SEND_DELAY_MS);
    expect(sendText).toHaveBeenCalledTimes(2);
    expect(sendText.mock.calls[0]).toEqual(["term_active", "cd /ws", true]);
    expect(sendText.mock.calls[1]).toEqual([
      "term_active",
      "npx skills add x -y",
      true,
    ]);
  });

  it("does not cd for user scope even when falling back to the active terminal", async () => {
    const { ctx, sendText } = makeCtx({
      createId: null,
      activeId: "term_active",
    });
    vi.mocked(ctx.ui.confirmWithDontShowAgain).mockResolvedValue(true);

    await runConfirmedTerminalCommand(ctx, {
      cmd: "npx skills add x -g -y",
      scope: "user",
      workspaceFolder: "/ws",
      confirm: baseConfirm,
      busyNotify: "Running…",
      noTerminalError: "No terminal",
      onStarted: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(TERMINAL_SEND_DELAY_MS);
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith(
      "term_active",
      "npx skills add x -g -y",
      true,
    );
  });

  it("notifies an error and runs nothing when no terminal is available", async () => {
    const { ctx, sendText, focus, notify } = makeCtx({
      createId: null,
      activeId: null,
    });
    vi.mocked(ctx.ui.confirmWithDontShowAgain).mockResolvedValue(true);
    const onStarted = vi.fn();

    await runConfirmedTerminalCommand(ctx, {
      cmd: "npx skills add x -y",
      scope: "project",
      workspaceFolder: "/ws",
      confirm: baseConfirm,
      busyNotify: "Running…",
      noTerminalError: "No terminal available",
      onStarted,
    });

    expect(focus).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
    expect(onStarted).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("error", "No terminal available");
  });

  it("passes an undefined cwd and never cd's when there is no workspace folder", async () => {
    const { ctx, create, sendText } = makeCtx({ createId: null, activeId: "term_active" });
    vi.mocked(ctx.ui.confirmWithDontShowAgain).mockResolvedValue(true);

    await runConfirmedTerminalCommand(ctx, {
      cmd: "npx skills add x -g -y",
      scope: "user",
      workspaceFolder: null,
      confirm: baseConfirm,
      busyNotify: "Running…",
      noTerminalError: "No terminal",
      onStarted: vi.fn(),
    });

    expect(create).toHaveBeenCalledWith({ cwd: undefined });
    await vi.advanceTimersByTimeAsync(TERMINAL_SEND_DELAY_MS);
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText.mock.calls[0][1]).not.toMatch(/^cd /);
  });
});
