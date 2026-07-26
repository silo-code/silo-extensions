// Clipboard payloads for an issue — built as plain data (no React) so the menu
// builders are unit-testable and the views just map them to MenuItems.

export interface CopyAction {
  id: "url" | "number" | "agent-prompt";
  label: string;
  text: string;
}

export interface CopyableIssue {
  number: number;
  title: string;
  url: string;
  body?: string;
}

// Everything an agent needs to start work on the issue, formatted for pasting
// straight into a terminal prompt.
export function agentPrompt(issue: CopyableIssue): string {
  const body = issue.body?.trim() || "(no description)";
  return [`#${issue.number}: ${issue.title}`, "", body, "", issue.url].join("\n");
}

export function buildCopyActions(issue: CopyableIssue): CopyAction[] {
  return [
    { id: "url", label: "Copy issue URL", text: issue.url },
    { id: "number", label: "Copy issue number", text: `#${issue.number}` },
    { id: "agent-prompt", label: "Copy for agent", text: agentPrompt(issue) },
  ];
}
