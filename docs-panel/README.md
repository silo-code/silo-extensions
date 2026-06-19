# Documents Side Panel

A Silo extension that adds a dedicated side panel for browsing and reading markdown documentation. Unlike the file explorer, it shows only `.md` and `.mdx` files and opens them directly in rendered preview mode.

**Extension ID:** `silo.docs-panel`  
**Requires:** Silo 0.7+

## Features

- **Multiple folder roots** — add any number of folders (inside or outside the workspace) as independent root sections in the panel
- **Markdown-only tree** — only `.md` / `.mdx` files are shown; hidden files and other file types are filtered out
- **Auto-preview on click** — files open in rendered markdown preview rather than the raw text editor
- **Per-workspace state** — configured roots and tree collapse state are stored per workspace; switching workspaces swaps them automatically
- **File system watching** — the tree updates automatically when files are added, removed, or renamed

## Installation

### From a GitHub Release

Download the latest `.tgz` from the [releases page](https://github.com/silo-code/silo-extensions/releases?q=docs-panel) and install via **Settings → Extensions → Install from file**.

### From source

```sh
git clone https://github.com/silo-code/silo-extensions
cd silo-extensions/docs-panel
npm install
npm run build
```

Then in Silo: **Settings → Extensions → Install from folder** and select the `docs-panel` directory.

## Usage

The **Docs** panel appears in the right column of the side panel strip alongside Git, Search, and others.

### Adding a folder root

Hover over any existing root section header to reveal the action buttons, then click **+** to open the native folder picker. The selected folder is added as a new root section below the existing ones. You can add folders from anywhere on disk — they do not need to be inside the current workspace.

### Navigating

- Click a folder row to expand or collapse it
- Click a file row to open it in a temporary markdown preview tab (the tab becomes permanent once you make an edit)
- Use **↑ / ↓** to move between rows and **← / →** to collapse or expand folders

### Managing roots

Hover over a root section header to reveal three buttons:

| Button | Action |
|--------|--------|
| **+** | Add another folder root |
| **↺** | Refresh the tree (re-read the folder from disk) |
| **×** | Remove this root from the panel |

Roots are stored per workspace, so removing one only affects the current workspace.

## Building from source

```sh
npm install
npm run build        # writes dist/index.js
npm run build:watch  # rebuilds on file changes
```

Type-check only (no output):

```sh
npx tsc --noEmit
```

## Permissions

This extension declares the `fs:read` permission, which allows it to list directories and watch for file changes. It does not write to the file system.
