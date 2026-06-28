# System Monitor

A [Silo](https://github.com/silo-code/silo) extension that keeps CPU and memory usage visible at a glance — without leaving your editor.

![System Monitor panel showing memory donut chart and CPU history graph](assets/screenshot.png)

## What you get

- **Side panel** — a dedicated SYSTEM tab with a memory donut chart (App / Wired / Cache / Free) and a scrolling CPU history graph (User vs System split)
- **Status bar readouts** — compact live counters at the bottom of the window that stay visible even when the panel is closed
- **Configurable** — choose which metrics appear, on which surfaces, and in what order via Settings or the in-panel gear icon
- **Persistent settings** — your choices are saved across restarts and apply to all workspaces automatically

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
npm test             # unit tests
```
