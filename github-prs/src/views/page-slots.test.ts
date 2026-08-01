import { describe, it, expect } from "vitest";
import { commitPageSlot, commitsPageSlot, detailPageSlot, listPageSlot } from "./page-slots";
import type { PanelView } from "../view-stack";

const LIST: PanelView = { kind: "list" };
const DETAIL: PanelView = { kind: "detail", repoKey: "o/r", number: 42 };
const COMMITS: PanelView = { kind: "commits", repoKey: "o/r", number: 42 };
const COMMIT: PanelView = { kind: "commit", repoKey: "o/r", number: 42, sha: "abc123" };

describe("listPageSlot / detailPageSlot", () => {
  it("centers the list and parks detail off-screen right at the list view", () => {
    expect(listPageSlot(LIST)).toBe("current");
    expect(detailPageSlot(LIST)).toBe("parked-right");
  });

  it("centers detail and parks the list off-screen left at the detail view", () => {
    expect(listPageSlot(DETAIL)).toBe("parked-left");
    expect(detailPageSlot(DETAIL)).toBe("current");
  });
});

describe("commitsPageSlot / commitPageSlot", () => {
  it("parks both two levels right of the list", () => {
    expect(commitsPageSlot(LIST)).toBe("parked-right");
    expect(commitPageSlot(LIST)).toBe("parked-right");
  });

  it("parks both one level right of detail", () => {
    expect(commitsPageSlot(DETAIL)).toBe("parked-right");
    expect(commitPageSlot(DETAIL)).toBe("parked-right");
  });

  it("centers commits and parks shallower pages left, deeper pages right", () => {
    expect(listPageSlot(COMMITS)).toBe("parked-left");
    expect(detailPageSlot(COMMITS)).toBe("parked-left");
    expect(commitsPageSlot(COMMITS)).toBe("current");
    expect(commitPageSlot(COMMITS)).toBe("parked-right");
  });

  it("centers commit and parks every shallower page left", () => {
    expect(listPageSlot(COMMIT)).toBe("parked-left");
    expect(detailPageSlot(COMMIT)).toBe("parked-left");
    expect(commitsPageSlot(COMMIT)).toBe("parked-left");
    expect(commitPageSlot(COMMIT)).toBe("current");
  });
});
