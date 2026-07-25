import { describe, it, expect } from "vitest";
import { detailPageSlot, listPageSlot } from "./page-slots";
import type { PanelView } from "../view-stack";

const LIST: PanelView = { kind: "list" };
const DETAIL: PanelView = { kind: "detail", repoKey: "o/r", number: 42 };

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
