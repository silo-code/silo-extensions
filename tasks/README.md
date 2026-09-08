# Tasks (`silo.tasks`)

Silo-managed task lists — task management out of the box, with **no external
tracker required and nothing written into a repo**. Phases 1-2 of
[RFC 0031](https://github.com/silo-code/silo/blob/main/docs/proposals/0031-tasks-extension/proposal.md);
the proposal lives in the main `silo-code/silo` repo.

## What it does

Three surfaces over one list of lists — a global, deliberately **unnamed**
list plus one per open workspace:

- The right-side **Tasks panel** — the active workspace's list and the personal
  one, with a quick-add box docked at the bottom.
- The **Tasks** view in the **Navigator** — *every* open workspace's list plus
  the personal one, grouped by workspace, for "what is on my plate everywhere".
  Its arrange / filter controls sit in the Navigator's own header. It is a list:
  picking a task opens it in the Tasks app rather than replacing the Navigator
  with a detail page, and the sheet grows out of whichever column you have the
  Navigator docked in.
- The **Tasks app** — the same cross-workspace list in a dock-anchored sheet
  with room to read, and where a task picked in the Navigator opens. Open it
  empty with the `silo.tasks.open` command. It is non-modal: the rest of the
  workbench stays live while it is open. Its list page is a **multiline row**
  per task (status, title, description preview, labels, list, id, and
  updated time) rather than the panel's single-line rows, with a **composer**
  (title, priority, labels, and a picker for which list the task lands in)
  and **batch editing** — pick several rows and set status, set priority, or
  add a label to all of them at once.

All three share one set of loaded lists and one set of file watches, so an edit
in any of them shows up in the others immediately, as does an external change to
a `tasks.jsonl` on disk.

- Group by list / status / label, sort by creation order / recency / priority
  / title, filter by lane and label, and search (matches title, labels, and an
  exact task id). The panel keeps these per workspace; the Navigator view and
  the Tasks app share one setting between them.
- Open a task to edit its title, lane, priority, labels, description, due date,
  and acceptance criteria; complete or delete it. The panel opens it in place;
  the Navigator hands it to the Tasks app.
- Commands for other extensions / agents: `silo.tasks.newInWorkspace`,
  `silo.tasks.newInApp`, `silo.tasks.refresh`, `silo.tasks.open`. All run
  usefully with no arguments, so any of them can be bound to a shortcut.

The panel's quick-add always creates in the **active** workspace's list (the
personal one when no workspace is open) — it has no destination picker, since
"active workspace" is always well-defined there. The Tasks app's composer does
have one: pick any resolved list (any open workspace's, or the unnamed global
one — shown as "No list" in the picker) before adding, since the sheet has no
single "active" workspace to default to.

## Where your data lives

Each list is a newline-delimited JSON file (`tasks.jsonl`, one task per line,
trailing newline) in the extension's **own storage directory** — outside any
repo, under Silo's user-config root:

```
~/.config/silo[-<identity>]/extension-storage/silo.tasks/
├── global/tasks.jsonl                ← the unnamed global list
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
`workspaceDir()` and the `ctx.files` own-dir sandbox lift; on
`ctx.storage.workspaceDirs()` for the cross-workspace surfaces, which resolves a
storage directory for every open workspace in one call; and on
`NavigatorViewProps.panelId`, which is what lets the Navigator view anchor the
Tasks app sheet to its own column. Those land in `@silo-code/sdk` **0.46.0** and
Silo **0.65.0** — the SDK devDependency and `silo.engine` pins.

`silo.engine` is informational (the host does not enforce it), so the sheet
degrades rather than breaking on an older app: without `panelId` it anchors to
the Tasks side panel, which is where it opened before this shipped.

Standard extension build:

```
npm install
npm run build        # esbuild → dist/index.js
npx tsc --noEmit
npx vitest run
```
