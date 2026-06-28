import { describe, it, expect, vi } from "vitest";
import type { ExtensionContext } from "@silo-code/sdk";
import { parseWindowsSample, createWindowsCollector } from "./windows";

const KB = 1024;

// SAMPLE_PS emits four lines: userCpu, sysCpu, totalKb, freeKb.
describe("parseWindowsSample", () => {
  it("reads cpu (user/privileged) then memory (total/free KB)", () => {
    const r = parseWindowsSample("12.5\n4.25\n33554432\n8388608");
    expect(r.cpu).toEqual({ user: 12.5, sys: 4.25 });
    expect(r.mem?.totalBytes).toBe(33554432 * KB);
    expect(r.mem?.usedBytes).toBe((33554432 - 8388608) * KB);
    expect(r.mem?.segments.map((s) => s.label)).toEqual(["Used", "Free"]);
    const sum = r.mem!.segments.reduce((a, s) => a + s.bytes, 0);
    expect(sum).toBe(33554432 * KB);
  });

  it("tolerates locale decimal commas and blank lines", () => {
    const r = parseWindowsSample("\n12,5\n4,25\n33554432\n8388608\n");
    expect(r.cpu).toEqual({ user: 12.5, sys: 4.25 });
    expect(r.mem?.totalBytes).toBe(33554432 * KB);
  });

  it("clamps cpu to 0–100", () => {
    const r = parseWindowsSample("150\n-5\n100\n50");
    expect(r.cpu).toEqual({ user: 100, sys: 0 });
  });

  it("nulls cpu/mem independently when their numbers are missing", () => {
    expect(parseWindowsSample("12.5\n4.25").mem).toBeNull(); // cpu only
    expect(parseWindowsSample("12.5\n4.25").cpu).toEqual({ user: 12.5, sys: 4.25 });
    expect(parseWindowsSample("0\n0\n0\n100").mem).toBeNull(); // zero total
  });
});

describe("createWindowsCollector", () => {
  it("coalesces a poll's cpu() + memory() onto a single exec", async () => {
    const exec = vi
      .fn()
      .mockResolvedValue({ stdout: "10\n5\n8000000\n2000000", code: 0, stderr: "" });
    const ctx = { process: { exec } } as unknown as ExtensionContext;
    const c = createWindowsCollector(ctx);

    const [cpu, mem] = await Promise.all([c.cpu(), c.memory()]);
    expect(exec).toHaveBeenCalledTimes(1); // one PowerShell process, not two
    expect(cpu).toEqual({ user: 10, sys: 5 });
    expect(mem?.totalBytes).toBe(8000000 * KB);
  });

  it("re-samples on a subsequent poll", async () => {
    const exec = vi
      .fn()
      .mockResolvedValue({ stdout: "10\n5\n8000000\n2000000", code: 0, stderr: "" });
    const ctx = { process: { exec } } as unknown as ExtensionContext;
    const c = createWindowsCollector(ctx);

    await Promise.all([c.cpu(), c.memory()]);
    await Promise.all([c.cpu(), c.memory()]);
    expect(exec).toHaveBeenCalledTimes(2); // once per poll
  });
});
