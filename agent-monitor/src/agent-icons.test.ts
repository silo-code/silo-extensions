import { describe, it, expect } from "vitest";
import { agentIconFor } from "./agent-icons";

describe("agentIconFor", () => {
  it("returns the brand icon for every catalog agent id", () => {
    expect(agentIconFor("claude")).toMatchObject({ title: "Claude Code", hex: "D97757" });
    expect(agentIconFor("cursor")).toMatchObject({ title: "Cursor" });
    expect(agentIconFor("copilot")).toMatchObject({ title: "GitHub Copilot" });
    expect(agentIconFor("codex")).toMatchObject({ title: "Codex" });
    expect(agentIconFor("grok")).toMatchObject({ title: "Grok" });
  });

  it("marks the icons whose path assumes evenodd fill, and only those", () => {
    expect(agentIconFor("codex")?.fillRule).toBe("evenodd");
    expect(agentIconFor("grok")?.fillRule).toBe("evenodd");
    expect(agentIconFor("claude")?.fillRule).toBeUndefined();
    expect(agentIconFor("cursor")?.fillRule).toBeUndefined();
    expect(agentIconFor("copilot")?.fillRule).toBeUndefined();
  });

  it("returns undefined for an unknown or missing id", () => {
    expect(agentIconFor("not-a-real-agent")).toBeUndefined();
    expect(agentIconFor(undefined)).toBeUndefined();
  });
});
