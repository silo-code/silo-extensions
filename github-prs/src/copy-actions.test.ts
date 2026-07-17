import { describe, it, expect } from "vitest";
import { checkoutCommand, buildCopyActions } from "./copy-actions";

describe("checkoutCommand", () => {
  it("formats a gh pr checkout command", () => {
    expect(checkoutCommand(123)).toBe("gh pr checkout 123");
  });
});

describe("buildCopyActions", () => {
  it("builds URL, branch, and checkout actions", () => {
    const actions = buildCopyActions({
      url: "https://github.com/o/r/pull/7",
      headRefName: "feat/thing",
      number: 7,
    });
    expect(actions).toEqual([
      { id: "url", label: "Copy PR URL", text: "https://github.com/o/r/pull/7" },
      { id: "branch", label: "Copy branch name", text: "feat/thing" },
      { id: "checkout", label: "Copy checkout command", text: "gh pr checkout 7" },
    ]);
  });
});
