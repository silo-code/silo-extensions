import { describe, it, expect } from "vitest";
import { parsePsOutput } from "./ps";

describe("parsePsOutput", () => {
  it("parses macOS-shaped output (comm as full path)", () => {
    const out = [
      "    1     0     1   2048   0.0 /sbin/launchd",
      " 5678     1  5678   9984   1.2 /Applications/Visual Studio Code.app/Contents/MacOS/Electron",
    ].join("\n");
    const rows = parsePsOutput(out);
    expect(rows).toEqual([
      { pid: 1, ppid: 0, pgid: 1, rssKb: 2048, cpuPercent: 0, command: "/sbin/launchd" },
      {
        pid: 5678,
        ppid: 1,
        pgid: 5678,
        rssKb: 9984,
        cpuPercent: 1.2,
        command: "/Applications/Visual Studio Code.app/Contents/MacOS/Electron",
      },
    ]);
  });

  it("parses Linux (procps)-shaped output", () => {
    const out = "  100    1  100  4096  0.5 node";
    const rows = parsePsOutput(out);
    expect(rows).toEqual([
      { pid: 100, ppid: 1, pgid: 100, rssKb: 4096, cpuPercent: 0.5, command: "node" },
    ]);
  });

  it("keeps commands with embedded spaces intact", () => {
    const out = "  200  100  100  1024  0.0 npm run dev --watch";
    const rows = parsePsOutput(out);
    expect(rows[0].command).toBe("npm run dev --watch");
  });

  it("skips malformed lines", () => {
    const out = [
      "  100    1  100  4096  0.5 node", // valid
      "not a ps line at all",
      "",
      "   1    2    3 abc  0.0 broken-rss",
    ].join("\n");
    const rows = parsePsOutput(out);
    expect(rows).toHaveLength(1);
    expect(rows[0].pid).toBe(100);
  });

  it("returns an empty array for empty input", () => {
    expect(parsePsOutput("")).toEqual([]);
    expect(parsePsOutput("\n\n")).toEqual([]);
  });
});
