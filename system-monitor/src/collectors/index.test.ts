import { describe, it, expect } from "vitest";
import type { ExtensionContext } from "@silo-code/sdk";
import { selectCollector } from "./index";

// The factories only touch ctx lazily inside cpu()/memory(), so a bare stub is
// enough to assert the selector wires each OS to the matching collector.
const ctx = {} as ExtensionContext;

describe("selectCollector", () => {
  it("maps each OS to a collector reporting that OS", () => {
    expect(selectCollector("macos", ctx).os).toBe("macos");
    expect(selectCollector("linux", ctx).os).toBe("linux");
    expect(selectCollector("windows", ctx).os).toBe("windows");
  });
});
