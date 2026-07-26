import { describe, it, expect } from "vitest";
import { listPageSlot, detailPageSlot } from "./page-slots";

describe("listPageSlot / detailPageSlot", () => {
  it("centers the list and parks detail right when on the list view", () => {
    expect(listPageSlot({ kind: "list" })).toBe("current");
    expect(detailPageSlot({ kind: "list" })).toBe("parked-right");
  });

  it("parks list left and centers detail when on the detail view", () => {
    const view = { kind: "detail" as const, repoKey: "o/r", number: 1 };
    expect(listPageSlot(view)).toBe("parked-left");
    expect(detailPageSlot(view)).toBe("current");
  });
});
