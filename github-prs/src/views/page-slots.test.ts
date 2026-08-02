import { describe, it, expect } from "vitest";
import {
  commitPageSlot,
  commitsPageSlot,
  detailPageSlot,
  filesPageSlot,
  listPageSlot,
  reviewPageSlot,
} from "./page-slots";
import type { PanelView } from "../view-stack";

const LIST: PanelView = { kind: "list" };
const DETAIL: PanelView = { kind: "detail", repoKey: "o/r", number: 42 };
const COMMITS: PanelView = { kind: "commits", repoKey: "o/r", number: 42 };
const COMMIT: PanelView = { kind: "commit", repoKey: "o/r", number: 42, sha: "abc123" };
const FILES: PanelView = { kind: "files", repoKey: "o/r", number: 42 };
const REVIEW: PanelView = { kind: "review", repoKey: "o/r", number: 42, reviewId: "PRR_1" };

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

describe("filesPageSlot — sibling of commits at the same depth", () => {
  it("parks right of the list and detail, like commits", () => {
    expect(filesPageSlot(LIST)).toBe("parked-right");
    expect(filesPageSlot(DETAIL)).toBe("parked-right");
  });

  it("centers files and parks shallower pages left, commit (deeper) right", () => {
    expect(listPageSlot(FILES)).toBe("parked-left");
    expect(detailPageSlot(FILES)).toBe("parked-left");
    expect(filesPageSlot(FILES)).toBe("current");
    expect(commitPageSlot(FILES)).toBe("parked-right");
  });

  // The bug depth-equality alone would reintroduce: commits and files share
  // VIEW_DEPTH (both reached directly from detail), so a naive "pageDepth ===
  // currentDepth" check would make BOTH "current" — i.e. both at
  // translateX(0) — simultaneously, bringing back the transparent-page
  // bleed-through this whole slot system exists to prevent. Kind equality
  // must win over depth equality.
  it("never reports files as current while viewing commits, or vice versa", () => {
    expect(filesPageSlot(COMMITS)).not.toBe("current");
    expect(commitsPageSlot(FILES)).not.toBe("current");
    expect(filesPageSlot(COMMITS)).toBe("parked-right");
    expect(commitsPageSlot(FILES)).toBe("parked-right");
  });
});

describe("reviewPageSlot — a third sibling at the same depth", () => {
  it("parks right of the list and detail, like commits and files", () => {
    expect(reviewPageSlot(LIST)).toBe("parked-right");
    expect(reviewPageSlot(DETAIL)).toBe("parked-right");
  });

  it("centers review and parks shallower pages left, commit (deeper) right", () => {
    expect(listPageSlot(REVIEW)).toBe("parked-left");
    expect(detailPageSlot(REVIEW)).toBe("parked-left");
    expect(reviewPageSlot(REVIEW)).toBe("current");
    expect(commitPageSlot(REVIEW)).toBe("parked-right");
  });

  // All three siblings (commits, files, review) share VIEW_DEPTH — verify
  // none of them ever reports "current" while either of the other two is
  // the active view.
  it("never collides with commits or files", () => {
    expect(reviewPageSlot(COMMITS)).toBe("parked-right");
    expect(reviewPageSlot(FILES)).toBe("parked-right");
    expect(commitsPageSlot(REVIEW)).toBe("parked-right");
    expect(filesPageSlot(REVIEW)).toBe("parked-right");
  });
});
