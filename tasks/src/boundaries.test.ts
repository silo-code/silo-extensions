import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const UI_DIR = fileURLToPath(new URL("./ui", import.meta.url));
const MODEL_DIR = fileURLToPath(new URL("./model", import.meta.url));
const LIB_DIR = fileURLToPath(new URL("./lib", import.meta.url));

/** Doc comments legitimately *name* `ctx.storage`; only code counts. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

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

  it("covers every phase-2 surface, not just the phase-1 panel", () => {
    const names = walk(UI_DIR).map((f) => f.split("/").pop());
    // A rename or a new surface that skips the grep above would pass the two
    // assertions vacuously; pin the files they are actually protecting.
    expect(names).toEqual(
      expect.arrayContaining([
        "TasksBody.tsx",
        "TasksPanel.tsx",
        "CrossTasksView.tsx",
        "TasksAppSheet.tsx",
        "use-drill-in.ts",
      ]),
    );
  });
});

describe("R7 — model/ and lib/ stay pure", () => {
  it("neither imports React", () => {
    const offenders: string[] = [];
    for (const file of [...walk(MODEL_DIR), ...walk(LIB_DIR)]) {
      const text = readFileSync(file, "utf8");
      if (/from\s+["']react(\/|["'])/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("neither reaches for an ExtensionContext value", () => {
    const offenders: string[] = [];
    for (const file of [...walk(MODEL_DIR), ...walk(LIB_DIR)]) {
      const text = readFileSync(file, "utf8");
      // Type-only SDK imports are fine (`ExtensionStorage`, `MenuEntry`); a
      // value import of the SDK, or a `ctx.` reach, is not.
      if (/^import\s+(?!type\b)[^;]*from\s+["']@silo-code\/sdk["']/m.test(text)) {
        offenders.push(file);
      }
      if (/\bctx\./.test(stripComments(text))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
