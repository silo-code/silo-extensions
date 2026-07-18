# GitHub Pull Requests

Side-panel browsing and actions for pull requests belonging to GitHub remotes in a Silo workspace.

## Language

**Pull Request (PR)**:
An open proposal to land a branch into another branch on a GitHub repository, as shown in the panel.
_Avoid_: MR, change request

**Merge-ready**:
A pull request GitHub will accept a merge for right now: open, not draft, and `mergeStateStatus` is `CLEAN`.
_Avoid_: mergeable (GitHub’s conflict-only field), ready to merge, able to be merged

**Unable to be merged**:
Any pull request that is not merge-ready — including conflicts, blocked checks or reviews, behind base, draft, closed, or status still unknown. When Merge is shown but disabled, a tooltip names the reason.
_Avoid_: unmergeable (reads as conflicts-only)

**Merge**:
The user action that immediately lands a merge-ready pull request into its base branch via GitHub. Offered for every pull request that is not already merged; enabled only when merge-ready. Always confirmed by the user before it runs. Does not delete the head branch (repo settings may still delete the remote branch). Does not use admin bypass, enable auto-merge, or manage merge queues. After success, the detail view stays open, refreshes to the merged state, and a short success notification is shown. On failure, an error notification is shown, the detail view stays open, and data is refreshed.
_Avoid_: land, ship, complete

**Merged**:
A pull request that has already been landed into its base branch. Merge is not offered.
_Avoid_: completed, landed, closed (closed means shut without merging)

**Merge method**:
How GitHub lands the pull request: squash, merge commit, or rebase. When the repository allows only one method, that method is used. When more than one is allowed, the user picks from a menu, then confirms.
_Avoid_: merge strategy, land style
