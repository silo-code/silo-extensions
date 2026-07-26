# GitHub Issues

Side-panel browsing and actions for issues belonging to GitHub remotes in a Silo workspace.

## Language

**Issue**:
A tracked unit of work on a GitHub repository, as shown in the panel.
_Avoid_: ticket, task (unless quoting GitHub's own UI)

**Status**:
Whether an issue is open, closed as completed, or closed as not planned — GitHub's
own three-way state. Plain issues have no other status (in-progress/done labels
are a Projects feature, out of scope here).
_Avoid_: state (reserve for the raw open/closed field), in progress

**Close**:
The user action that marks an open issue closed, with a required reason
(completed or not planned). Always confirmed by the user before it runs. The
detail view stays open and refreshes to the closed state.
_Avoid_: resolve, complete (ambiguous with the "completed" reason specifically)

**Reopen**:
The user action that marks a closed issue open again. Always confirmed by the
user before it runs.

**Copy for agent**:
The clipboard action that formats an issue's number, title, description, and
URL as plain text meant for pasting into a terminal, so a coding agent can pick
up the task with full context in one paste.
_Avoid_: copy prompt, export
