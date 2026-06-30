---
name: polish-extension
description: Pre-release quality pass on a Silo extension — six parallel agents review architecture, React correctness, CSS token compliance, code quality, test coverage, and public readiness, then apply all findings. Run after writing an extension to make it fit for the public gallery.
tools: Bash, Read, Write, Edit
---

# Silo Extension Polish

A pre-release quality sweep. The goal: make the extension something a new
developer would be proud to read as a reference implementation. Not a feature
review — assume the extension already does what it's supposed to do.

## Phase 0 — Read the source

Identify the target extension (from the argument, or the nearest extension
directory). Read every file under `src/`. Also read `system-monitor/src/` —
it is the canonical reference; agents compare against it.

## Phase 1 — Six review agents, all at once

Launch all six in a single message. Give each agent the full source of both
the target extension and `system-monitor`. Each agent returns a flat list of
findings: `file`, `line`, one-line `summary`, and the `fix` — concrete enough
to apply directly, not general advice.

---

### Agent 1 — Architecture

Is the extension correctly wired into the Silo extension contract?

- `index.tsx` only: inject style, register `ctx.*`, return `{ deactivate }` that
  removes the style element and cancels all timers/subscriptions. Nothing else.
- Style injection is idempotent: guard with `document.getElementById(STYLE_ID)`.
- Only `@silo-code/sdk` is imported. No `@tauri-apps/*`, `node:*`, or anything
  from `@silo-code/extension-host` or its internal subpaths.
- Polling is demand-driven: a `neededFeatures(settings)` (or equivalent) is
  called before each tick; zero I/O runs when all features are disabled.
- Per-feature updates are independent. A failure parsing feature A must not
  prevent feature B from updating — no early `return` after the first parse failure.
- Errors render **inside** the panel body. The gear/settings button is outside
  the error region and is always visible when not in settings mode.
- Settings component is dual-mode: `onClose` prop → inline overlay layout;
  no `onClose` → `es-page` / `es-scroll` registered page layout. One component,
  not two.

---

### Agent 2 — React

Is the React code idiomatic and correct?

- No Rules of Hooks violations: no hooks called conditionally, in loops, or
  inside event callbacks.
- Every `useEffect` that subscribes (valtio `subscribe`, `setInterval`,
  `addEventListener`) returns a cleanup. No leaked subscriptions.
- `key` props use stable string ids, never array indices — critical in
  draggable/reorderable lists.
- Logic lives in pure, exported helper functions so it can be unit-tested without
  rendering. Components are thin: they read state and pass it to helpers.
- Values read inside `setInterval` / `setTimeout` callbacks use `useRef` so the
  interval doesn't need to be re-registered on every render.
- No redundant state — nothing stored in `useState` that can be derived from
  other state or props.
- No `any`. Every parameter and return type is explicit. Registry component
  types use `React.ComponentType<Props>`, not `React.FC`.
- Props interfaces are named and exported; no inline object types on component
  signatures.

---

### Agent 3 — CSS

Does the CSS respect the Silo design token contract?

- CSS is in `styles.css`, not a template-literal string in any `.ts`/`.tsx` file.
- `build.mjs` has `loader: { ".css": "text" }`. `css.d.ts` declares
  `module "*.css" { const content: string; export default content; }`.
- Every property that varies with the theme uses the appropriate token tier:
  colors → `--silo-color-*`, type → `--silo-font-ui` / `--silo-font-mono` /
  `--silo-font-size-*`, corners → `--silo-radius-*`, button chrome →
  `--silo-button-*`.
- No component tokens (`--silo-content-*`, `--silo-statusbar-*`) or internal
  tokens (`--silo-internal-*`).
- No hard-coded hex/rgb colors, named colors, pixel font sizes, or font family
  strings.
- All class names share one short extension-specific prefix (`sm-`, `dp-`, …).
  No bare global names.
- `font-size` uses `calc(1em ± Npx)` so `uiFontSize` scaling propagates.

---

### Agent 4 — Code Quality

Is the code clean and free of accidental complexity?

*Reuse* — new code that re-implements something already in `system-monitor` or
elsewhere in this extension: `DraggableSection`, `Toggle`, `reorder()`, shared
hooks, icons. Name the existing thing to use instead.

*Simplification* — derivable state stored in `useState`; parallel arrays/lists
with the same shape that should be a single data table; copy-paste with slight
variation that should be a shared function; deep nesting that should be
extracted; dead code (unused imports, unreachable branches, stale variables).

*Efficiency* — sequential `await`s for independent operations (should be
`Promise.all`); work done on every render that should be computed once; closures
that capture large objects when only one field is needed.

*Altitude* — special-case bandaids layered on shared logic instead of fixing
the underlying mechanism; anything that would surprise a reader familiar with
the codebase.

Also flag: stray `console.log` (only `console.error` for dev warnings is OK),
TODO/FIXME comments, magic literals that should be named constants.

---

### Agent 5 — Tests

Is the pure logic fully exercised?

- Every pure function that contains logic has a co-located `*.test.ts` file.
- Minimum coverage: parse helpers (use real command-output strings as fixtures),
  `neededFeatures()` (all enable/disable combos), `mergeSettings()` / `mergeList()`
  (valid ids, unknown ids, empty input).
- Edge cases present: empty input, all-disabled settings, parse failure,
  unknown registry id, boundary values.
- No component rendering in tests. Logic is in exported pure helpers; tests
  import those directly.
- `vitest.config.ts` `include` is `["src/**/*.{test,spec}.{ts,tsx}"]`.
- `npm test` passes with zero failures and no unexplained skips.

---

### Agent 6 — Public Readiness

Would a new developer be proud to read this as a reference?

- No internal codenames, brand names, or project-specific jargon in source,
  comments, or user-visible strings.
- No placeholder text, stub implementations, or half-finished features.
- User-facing error messages are clear and actionable: explain what failed and
  what the user can do (e.g. "Requires macOS — CPU stats unavailable on this
  platform." not "parse error").
- Dev warnings (`console.error`) fire only on genuinely unexpected developer
  mistakes (unknown registry id), not on normal flows or expected errors.
- `package.json` `name`, `description`, and `version` are final.
- `README.md` exists: what the extension does, platform requirements,
  installation, and at least a description of the UI (screenshot if one exists).
- No commented-out code blocks.
- No unexplained `as any` or `as unknown as X` — if a cast is truly necessary,
  one-line comment explains why.

---

## Phase 2 — Apply

Wait for all six. Dedup findings that point at the same mechanism. Fix
everything that is clearly correct. For each skip, state the reason in one
line. Don't be conservative: if a function needs to be extracted, extract it;
if a test file needs to be written from scratch, write it.

Finish with: `npm test && npm run typecheck && node build.mjs`. Report the
outcome and a one-paragraph summary of what changed.
