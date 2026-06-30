---
name: new-extension
description: Scaffold a new Silo extension or refactor an existing one to the reference architecture — separate CSS, modular per-feature components, demand-driven work, registry pattern, shared hooks/icons, and unit tests. Based on system-monitor as the canonical reference.
tools: Bash, Read, Write, Edit
---

# Silo Extension Scaffold / Refactor

Creates or refactors a Silo extension to match the **system-monitor** reference
architecture. Read `system-monitor/src/` before starting — it's the canonical
implementation, not just documentation.

## When to use

- Starting a new extension from scratch
- Bringing an existing extension up to standard (CSS embedded as a string,
  no tests, monolithic `index.tsx`, `@silo-code/sdk` internals reached directly, etc.)

## Reference file structure

```
<ext-name>/src/
├── css.d.ts                 # declare module "*.css" → string
├── styles.css               # all CSS using --silo-* tokens only
├── hooks.ts                 # useStore(), useSize() shared hooks
├── icons.tsx                # SVG icons as named exports
├── index.tsx                # thin activate() + deactivate()
├── metrics.ts               # parse helpers, formatters, pure constants
├── poll.ts                  # neededFeatures() + startPolling()
├── registry.ts              # FEATURE_REGISTRY + getDescriptor()
├── store.ts                 # valtio proxy, Settings, LiveData, mergeSettings()
├── metrics/
│   └── <name>/
│       ├── Panel.tsx
│       └── Status.tsx
└── views/
    ├── DraggableSection.tsx # drag-reorder list (copy from system-monitor)
    ├── <Ext>Panel.tsx       # side panel container
    ├── <Ext>Settings.tsx    # dual-mode: inline overlay + settings page
    ├── <Ext>Status.tsx      # status bar group
    └── Toggle.tsx           # es-switch wrapper (copy from system-monitor)
```

Extensions without a status bar or settings page drop those files; the rest is
always present.

## The seven patterns

### 1. CSS in a file, never an embedded string

`build.mjs` — add the css loader:
```js
loader: { ".css": "text" }
```

`src/css.d.ts`:
```ts
declare module "*.css" {
  const content: string;
  export default content;
}
```

`src/index.tsx` — inject once on activation, remove on deactivation:
```ts
import STYLES from "./styles.css";
const STYLE_ID = "my-ext-styles";

export const extension = {
  activate(ctx) {
    if (!document.getElementById(STYLE_ID)) {
      const el = document.createElement("style");
      el.id = STYLE_ID;
      el.textContent = STYLES;
      document.head.appendChild(el);
    }
    // ...register ctx.*...
    return { deactivate() { document.getElementById(STYLE_ID)?.remove(); } };
  },
};
```

CSS rules:
- One short prefix per extension (`sm-`, `dp-`, `lwv-`, …) — never global names
- **Only `--silo-color-*`, `--silo-font*`, `--silo-radius-*`, `--silo-button-*`**
  design tokens — never `--silo-content-*`, `--silo-statusbar-*`, `--silo-internal-*`
- No hard-coded hex colors, font families, or px sizes that belong in the theme

### 2. Registry for extensible features

When there are multiple independent features, panels, or metrics:

```ts
// registry.ts
export interface FeatureDescriptor {
  id: FeatureId;
  label: string;
  panelHint: string;
  sbHint: string;
  /** Omit for status-bar-only entries. */
  PanelComponent?: React.ComponentType<{ live: LiveData }>;
  StatusComponent: React.ComponentType<{ live: LiveData }>;
}

export const FEATURE_REGISTRY: FeatureDescriptor[] = [
  { id: "a", label: "A", ..., PanelComponent: APanel, StatusComponent: AStatus },
  { id: "b", label: "B", ..., PanelComponent: BPanel, StatusComponent: BStatus },
];

// To add feature "c": add an entry here + Panel.tsx + Status.tsx + poll handler.
// Nothing else needs to change.

export function getDescriptor(id: FeatureId): FeatureDescriptor | undefined {
  const d = FEATURE_REGISTRY.find((m) => m.id === id);
  if (!d) console.error(`[my-ext] Unknown id: "${id}". Add an entry to FEATURE_REGISTRY.`);
  return d;
}
```

### 3. Demand-driven work

Never compute or fetch data that nothing is displaying:

```ts
// poll.ts
export function neededFeatures(settings: Settings): Set<FeatureId> {
  const needed = new Set<FeatureId>();
  for (const item of [...settings.panels, ...settings.statusBar]) {
    if (item.enabled) needed.add(item.id);
  }
  return needed;
}

async function poll() {
  const needed = neededFeatures(myStore.settings);
  if (needed.size === 0) return;

  const [aResult, bResult] = await Promise.all([
    needed.has("a") ? fetchA() : Promise.resolve(null),
    needed.has("b") ? fetchB() : Promise.resolve(null),
  ]);

  // Independent updates — A's failure must not silence B's success:
  const patch: Partial<LiveData> = { error: null };
  if (aResult !== null) {
    const parsed = parseA(aResult);
    if (!parsed) patch.error = "Could not parse A output.";
    else patch.a = parsed;
  }
  if (bResult !== null) {
    const parsed = parseB(bResult);
    if (!parsed) patch.error = "Could not parse B output.";
    else patch.b = parsed;
  }
  myStore.updateLive(patch);
}
```

The key mistake to avoid: an early `return` after the first failure that prevents
later features from updating.

### 4. Error display inside the panel, not replacing the gear

```tsx
// views/MyPanel.tsx
return (
  <div className="my-ext">
    {!showSettings && (
      <button className="my-gear-btn" onClick={() => setShowSettings(true)}>
        <GearIcon />
      </button>
    )}
    {showSettings ? (
      <MySettings onClose={() => setShowSettings(false)} />
    ) : (
      <div className="my-panels">
        {live.error ? (
          <div className="my-error">{live.error}</div>
        ) : visiblePanels.length === 0 ? (
          <div className="my-empty">All panels hidden. Open Settings to re-enable them.</div>
        ) : (
          visiblePanels.map((p) => {
            const d = getDescriptor(p.id);
            if (!d) return null;
            return <d.PanelComponent key={p.id} live={live} />;
          })
        )}
      </div>
    )}
  </div>
);
```

The gear button renders outside `my-panels`. An error never removes the user's
path to settings — they can always navigate there to disable the failing feature.

### 5. Dual-mode settings (inline overlay + registered settings page)

One component, two layouts, driven by the presence of `onClose`:

```tsx
export function MySettings({ onClose }: { onClose?: () => void }) {
  const layout = onClose
    ? { outer: "my-settings-overlay", scroll: "my-settings-scroll" }
    : { outer: "es-page", scroll: "es-scroll" };

  return (
    <div className={layout.outer}>
      {onClose
        ? <div className="my-settings-header"><button onClick={onClose}>← Back</button></div>
        : <div className="es-header"><h2>My Extension</h2></div>}
      <div className={layout.scroll}>
        {/* settings content — same in both modes */}
      </div>
    </div>
  );
}
```

Register as both:
```ts
ctx.registerSidePanel({ id, render: (props) => <MyPanel {...props} /> });
ctx.registerSettingsPage({ id, render: () => <MySettings /> });
```

### 6. Shared hooks and icons

Always extract these before building components:

`src/hooks.ts`:
```ts
import { useEffect, useState } from "react";
import { subscribe } from "valtio";
import { myStore } from "./store";

export function useStore() {
  const [state, setState] = useState(() => myStore.snapshot());
  useEffect(() => subscribe(myStore.proxy, () => setState(myStore.snapshot())), []);
  return state;
}
```

`src/icons.tsx` — one file, all SVG icons as named functions. No third-party
icon library; inline SVG keeps the bundle small and controllable.

### 7. Unit tests for all pure logic

Test helpers, parsers, and store logic — not rendered components:

```ts
// poll.test.ts  — neededFeatures() with all enable/disable combinations
// store.test.ts — mergeSettings(), mergeList() with valid and unknown ids
// metrics.test.ts — parse helpers with real command output samples
```

Run: `npm test` (vitest, picks up `src/**/*.{test,spec}.{ts,tsx}`).
The vitest config should be `include: ["src/**/*.{test,spec}.{ts,tsx}"]`.

## Checklist

Verify all of these before calling an extension done:

- [ ] CSS in `styles.css`, not an embedded string
- [ ] `build.mjs` has `loader: { ".css": "text" }`
- [ ] `css.d.ts` present with the `declare module "*.css"` declaration
- [ ] CSS uses only `--silo-color-*`, `--silo-font*`, `--silo-radius-*`, `--silo-button-*` tokens
- [ ] No hard-coded colors, font families, or px sizes that belong in the theme
- [ ] All CSS class names share a consistent extension-specific prefix
- [ ] `index.tsx` is thin: inject style, register `ctx.*`, return `{ deactivate }` that removes style
- [ ] Registry in `registry.ts` with dev-warning `getDescriptor()` (if multiple features)
- [ ] `neededFeatures()` exported and used — no I/O for disabled features
- [ ] Per-feature updates are independent — one parse failure doesn't silence others
- [ ] Error display inside the panel body, gear button always visible
- [ ] Settings component serves both inline and page mode from one component
- [ ] `hooks.ts` with `useStore()` (and `useSize()` if ResizeObserver is needed)
- [ ] `icons.tsx` with all SVGs as named exports
- [ ] Unit tests cover parse helpers, `neededFeatures`, and `mergeSettings/mergeList`
- [ ] `npm test` passes
- [ ] `npm run typecheck` passes
- [ ] `node build.mjs` produces a clean bundle

## Procedure

### New extension

1. Copy `system-monitor/` as a starting point; rename the prefix and extension id throughout
2. Delete metric-specific code (CPU/memory parsing, their Panel/Status components)
3. Implement your data model in `store.ts`
4. Write your data fetchers in `poll.ts`
5. Create `src/metrics/<name>/Panel.tsx` and `Status.tsx`
6. Register in `registry.ts`
7. Write unit tests for all parse/format/store helpers
8. Run the checklist

### Refactor existing extension

1. Read all current source files to understand what exists
2. Diff against the checklist — identify every gap
3. Apply fixes in this order (each step: `npm test && npm run typecheck && node build.mjs`):
   a. Extract CSS → `styles.css`; add `css.d.ts`; update `build.mjs`
   b. Extract shared hooks → `hooks.ts`; extract icons → `icons.tsx`
   c. Split monolithic component into `views/<Ext>Panel.tsx`, `views/<Ext>Settings.tsx`, etc.
   d. Add registry + `getDescriptor()` if the extension has multiple independent features
   e. Introduce demand-driven polling with `neededFeatures()`
   f. Fix error display (move inside panel body, keep gear button outside)
   g. Add unit tests for all pure logic
4. Run the full checklist when done
