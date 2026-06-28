# System Monitor

A [Silo](https://github.com/silo-code/silo) extension that shows live CPU and
memory usage — as charts in a right-side panel and as compact readouts in the
status bar.

## What it's for

Keep an eye on system load without leaving Silo. The side panel renders CPU and
memory history; the status bar shows at-a-glance readouts that stay live even
when the panel is closed. A settings page (and an in-panel gear) let you choose
which metrics appear, in which surfaces, and in what order.

## Uses `ctx.process.exec`

The extension reads metrics by running short-lived OS commands through
`ctx.process.exec()` — the host-mediated subprocess API — rather than any
platform-specific SDK surface. Polling runs at the extension level so the status
bar has data regardless of whether the panel is mounted; the poll skips metrics
that aren't currently visible.

## Settings persist with `ctx.storage`

Which panels and status-bar readouts are enabled is saved to
`ctx.storage.global` — per-extension storage shared across all workspaces — so
your choices survive restarts and apply everywhere. The store hydrates in
`activate()` and re-reads on change, so the status bar reflects saved settings
immediately on launch (no need to open the panel first).

## Installing

### From a GitHub Release

1. Go to [Releases](https://github.com/silo-code/silo-extensions/releases?q=system-monitor).
2. Right-click the `.tgz` asset → **Copy link address**.
3. In Silo: **Settings → Extensions**, paste the URL and click **Install**.

### From source

```sh
git clone https://github.com/silo-code/silo-extensions
cd silo-extensions/system-monitor
npm install
npm run build
```

Then in Silo: **Settings → Extensions → Install from folder**, point at this directory.

## Building

```sh
npm install
npm run build        # one-shot
npm run build:watch  # watch mode
npm test             # unit tests (metrics parsing, polling, settings store)
```

Output goes to `dist/index.js`. The bundle externalizes `react`,
`react/jsx-runtime`, and `@silo-code/sdk` — the Silo host supplies those at load
time — and inlines the stylesheet as a string injected at activate time.
