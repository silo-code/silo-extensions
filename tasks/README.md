# Tasks (`silo.tasks`)

Silo-managed task lists — task management out of the box, with **no external
tracker required and nothing written into a repo**. Phase 1 of
[RFC 0031](https://github.com/silo-code/silo/blob/main/docs/proposals/0031-tasks-extension/proposal.md);
the proposal lives in the main `silo-code/silo` repo.

## What it does

- A right-side **Tasks** panel with a global (**Personal**) list plus one list
  per open workspace.
- Group by source / status / label, sort by creation order / recency / priority
  / title, filter by lane and label, and search (matches title, labels, and an
  exact task id).
- Drill into a task to edit its title, lane, priority, labels, description, due
  date, and acceptance criteria; complete or delete it.
- Commands for other extensions / agents: `silo.tasks.new`,
  `silo.tasks.newInGlobal`, `silo.tasks.refresh`, `silo.tasks.complete`.

## Where your data lives

Each list is a newline-delimited JSON file (`tasks.jsonl`, one task per line,
trailing newline) in the extension's **own storage directory** — outside any
repo, under Silo's user-config root:

```
~/.config/silo[-<identity>]/extension-storage/silo.tasks/
├── global/tasks.jsonl                ← the Personal list
└── workspaces/<workspaceId>/tasks.jsonl   ← one per workspace
```

The extension declares **`permissions: []`** — RFC 0032's sandbox lift means it
reaches this directory through `ctx.files` with no `fs:read` / `fs:write`.

### The file format

Each line is one JSON object:

```json
{"v":1,"id":"t_ab12_00001x9k","title":"Ship the RFC","lane":"todo","priority":"high","rank":"000000000004","labels":["docs"],"description":"...","dueDate":"2026-09-15","acceptanceCriteria":[{"text":"tests green","done":false}],"createdAt":1756600000000,"updatedAt":1756600000000,"closedAt":null}
```

- `v` is the schema version. A line the extension can't parse — a hand-edit typo,
  or a record from a newer Silo — is **kept verbatim** and re-emitted on the next
  write, never dropped; a non-blocking notice names the file so you can fix it.
- `lane` is one of `todo | in_progress | blocked | done`.

### Pointing an agent at it

Until a Silo CLI lands, add one line to your repo's `AGENTS.md`:

```
Task list: read/append tasks as NDJSON at
~/.config/silo/extension-storage/silo.tasks/workspaces/<id>/tasks.jsonl
(one JSON object per line, keep the `v` and `rank` fields).
```

## Concurrent writes — the known limitation

The panel and an agent (or your editor) can both write `tasks.jsonl`. Every
mutation the extension makes is **compare-and-swap**: it re-checks the file
immediately before replacing it and, if something changed underneath, reloads
and re-applies rather than clobbering the other write. This closes the practical
window, **but not entirely** — a write that lands inside the final check→rename
gap is still lost. For a personal task list at this scale that residual is
accepted rather than designed away (no lock file, no journal). If you're
scripting heavy concurrent appends, pause the panel or expect the occasional
lost line.

## Development

This extension depends on RFC 0032's `ctx.storage.globalDir()` /
`workspaceDir()` and the `ctx.files` own-dir sandbox lift, which ship in
`@silo-code/sdk` **0.42.0** and Silo **0.59.0** — the `silo.engine` and SDK
devDependency pins. Standard extension build:

```
npm install
npm run build        # esbuild → dist/index.js
npx tsc --noEmit
npx vitest run
```
