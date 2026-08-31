import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const UI_DIR = fileURLToPath(new URL("./ui", import.meta.url));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("R5 — provider identity never leaks into a view", () => {
  it("the bare token `providerId` appears nowhere under src/ui", () => {
    const offenders: string[] = [];
    for (const file of walk(UI_DIR)) {
      const text = readFileSync(file, "utf8");
      // The bare token, not `providerId ===` — a switch, a spacing variant,
      // or an extracted constant must not slip past.
      if (/\bproviderId\b/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("no view branches on a hard-coded \"silo\" provider string", () => {
    const offenders: string[] = [];
    for (const file of walk(UI_DIR)) {
      const text = readFileSync(file, "utf8");
      if (/["']silo["']/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
