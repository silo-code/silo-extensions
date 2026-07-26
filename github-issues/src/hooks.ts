import { useEffect, useState } from "react";
import { issueStore } from "./store";

/** Subscribe to the issue store and re-render whenever it notifies. */
export function useIssueStore(): typeof issueStore {
  const [, tick] = useState(0);
  useEffect(() => issueStore.subscribe(() => tick((n) => n + 1)), []);
  return issueStore;
}
