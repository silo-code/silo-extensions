import { useEffect, useState } from "react";
import { prStore } from "./store";

/** Subscribe to the PR store and re-render whenever it notifies. */
export function usePrStore(): typeof prStore {
  const [, tick] = useState(0);
  useEffect(() => prStore.subscribe(() => tick((n) => n + 1)), []);
  return prStore;
}
