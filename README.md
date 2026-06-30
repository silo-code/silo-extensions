# silo-extensions

Official Silo extensions distributed outside the main [silo](https://github.com/silo-code/silo) repository. Each extension lives in its own top-level folder and is an independently installable package.

## Extensions

| Extension | Latest | Description |
|---|---|---|
| [Documents Side Panel](./docs-panel/) | [![latest](https://img.shields.io/github/v/release/silo-code/silo-extensions?filter=docs-panel*&label=)](https://github.com/silo-code/silo-extensions/releases?q=docs-panel) | Markdown documentation browser with configurable folder roots |
| [Local Web Viewer](./local-web-viewer/) | [![latest](https://img.shields.io/github/v/release/silo-code/silo-extensions?filter=local-web-viewer*&label=)](https://github.com/silo-code/silo-extensions/releases?q=local-web-viewer) | Embed local dev servers and `file://` pages as dock panels alongside your code |
| [System Monitor](./system-monitor/) | [![latest](https://img.shields.io/github/v/release/silo-code/silo-extensions?filter=system-monitor*&label=)](https://github.com/silo-code/silo-extensions/releases?q=system-monitor) | Live CPU and memory charts in a side panel and status bar |
| [GitHub Actions](./github-actions/) | [![latest](https://img.shields.io/github/v/release/silo-code/silo-extensions?filter=github-actions*&label=)](https://github.com/silo-code/silo-extensions/releases?q=github-actions) | Monitor workflow runs across workspaces with status bar and badge decorations (requires `gh` CLI) |

## Installing an extension

### From a GitHub Release (recommended)

1. Go to [Releases](../../releases) and find the release for the extension you want.
2. Right-click the `.tgz` asset and **Copy link address**.
3. In Silo: **Settings → Extensions**, paste the URL into the input field and click **Install**.

### From source

```sh
git clone https://github.com/silo-code/silo-extensions
cd silo-extensions/<extension>
npm install
npm run build
```

Then in Silo: **Settings → Extensions → Install from folder** and point at the extension directory.

## Development

### Structure

Each extension is a self-contained folder:

```
<extension-name>/
  src/            source files
  dist/           compiled bundle (gitignored; built by CI)
  build.mjs       esbuild config
  package.json    silo metadata (id, engine, permissions)
  tsconfig.json
```

### Building

```sh
cd <extension>
npm install
npm run build        # one-shot
npm run build:watch  # watch mode
```

Or build all extensions from the repo root:

```sh
npm run build:all
```

### Releases

Merging a PR into `main` automatically:

1. Detects which extension's source files changed.
2. Bumps the version — **patch** by default; add a `minor` or `major` label to the PR to override.
3. Builds the bundle, packs a tarball, and publishes a [GitHub Release](../../releases) tagged `<extension>@v<version>`.

No manual version bumping or tagging needed.

### Adding a new extension

1. Create a top-level folder for the extension (use an existing one as a template).
2. Add a build + typecheck job to `.github/workflows/ci.yml`.
3. Add a release job to `.github/workflows/release.yml`.

## Requirements

- Silo 0.7 or later
- Node.js 20 or later (for building from source)
