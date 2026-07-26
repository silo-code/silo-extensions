import { describe, it, expect } from "vitest";
import { agentPrompt, buildCopyActions } from "./copy-actions";

describe("agentPrompt", () => {
  it("formats number, title, body, and url for pasting into a terminal", () => {
    expect(
      agentPrompt({ number: 42, title: "Fix the thing", url: "https://github.com/o/r/issues/42", body: "It's broken." }),
    ).toBe("#42: Fix the thing\n\nIt's broken.\n\nhttps://github.com/o/r/issues/42");
  });

  it("falls back to a placeholder for an empty or missing body", () => {
    expect(agentPrompt({ number: 1, title: "T", url: "u", body: "" })).toContain("(no description)");
    expect(agentPrompt({ number: 1, title: "T", url: "u" })).toContain("(no description)");
  });

  it("trims whitespace-only bodies to the placeholder", () => {
    expect(agentPrompt({ number: 1, title: "T", url: "u", body: "   \n  " })).toContain("(no description)");
  });
});

describe("buildCopyActions", () => {
  it("builds URL, number, and agent-prompt actions", () => {
    const actions = buildCopyActions({
      number: 7,
      title: "Some bug",
      url: "https://github.com/o/r/issues/7",
      body: "Details here",
    });
    expect(actions).toEqual([
      { id: "url", label: "Copy issue URL", text: "https://github.com/o/r/issues/7" },
      { id: "number", label: "Copy issue number", text: "#7" },
      { id: "agent-prompt", label: "Copy for agent", text: "#7: Some bug\n\nDetails here\n\nhttps://github.com/o/r/issues/7" },
    ]);
  });
});
