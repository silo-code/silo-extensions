import type { PrListItem } from "./github-pr-api";

// Clipboard payloads for a PR — built as plain data (no React) so the menu
// builders are unit-testable and the views just map them to MenuItems.

export interface CopyAction {
  id: "url" | "branch" | "checkout";
  label: string;
  text: string;
}

export function checkoutCommand(number: number): string {
  return `gh pr checkout ${number}`;
}

export function buildCopyActions(pr: Pick<PrListItem, "url" | "headRefName" | "number">): CopyAction[] {
  return [
    { id: "url", label: "Copy PR URL", text: pr.url },
    { id: "branch", label: "Copy branch name", text: pr.headRefName },
    { id: "checkout", label: "Copy checkout command", text: checkoutCommand(pr.number) },
  ];
}
