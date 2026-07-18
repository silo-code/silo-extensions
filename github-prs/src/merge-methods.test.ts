import { describe, it, expect } from "vitest";
import {
  allowedMergeMethods,
  mergeConfirmCopy,
  type RepoMergeMethods,
} from "./merge-methods";

describe("allowedMergeMethods", () => {
  it("returns only enabled methods in squash-first order", () => {
    const all: RepoMergeMethods = { squash: true, merge: true, rebase: true };
    expect(allowedMergeMethods(all)).toEqual(["squash", "merge", "rebase"]);
    expect(allowedMergeMethods({ squash: true, merge: false, rebase: false })).toEqual([
      "squash",
    ]);
    expect(allowedMergeMethods({ squash: false, merge: true, rebase: true })).toEqual([
      "merge",
      "rebase",
    ]);
    expect(allowedMergeMethods({ squash: false, merge: false, rebase: false })).toEqual([]);
  });
});

describe("mergeConfirmCopy", () => {
  it("names the PR number, method, title, and base branch", () => {
    const copy = mergeConfirmCopy(
      { number: 55, title: "Add merge button", baseRefName: "main" },
      "squash",
    );
    expect(copy.title).toBe("Merge #55?");
    expect(copy.body).toContain("Squash and merge");
    expect(copy.body).toContain("Add merge button");
    expect(copy.body).toContain("main");
    expect(copy.confirmLabel).toBe("Merge");
  });
});
