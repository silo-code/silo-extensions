// In-panel navigation state — a tiny view stack (list → detail) with no SDK
// routing behind it. Pure so push/pop/restore are unit-testable, serialized as
// plain JSON so the panel can persist it in its per-workspace storage.

export type PanelView =
  | { kind: "list" }
  | { kind: "detail"; folder: string; number: number };

export interface ViewStack {
  // Invariant: views[0] is always the list root.
  views: PanelView[];
}

export const ROOT_STACK: ViewStack = { views: [{ kind: "list" }] };

export function pushView(stack: ViewStack, view: PanelView): ViewStack {
  return { views: [...stack.views, view] };
}

// No-op at the root — the list view can't be popped away.
export function popView(stack: ViewStack): ViewStack {
  if (stack.views.length <= 1) return stack;
  return { views: stack.views.slice(0, -1) };
}

export function currentView(stack: ViewStack): PanelView {
  return stack.views[stack.views.length - 1] ?? { kind: "list" };
}

export function serializeStack(stack: ViewStack): unknown {
  return stack.views;
}

function isPanelView(raw: unknown): raw is PanelView {
  if (!raw || typeof raw !== "object") return false;
  const v = raw as Record<string, unknown>;
  if (v.kind === "list") return true;
  return v.kind === "detail" && typeof v.folder === "string" && typeof v.number === "number";
}

// Restores a persisted stack, falling back to the root for anything that isn't
// a well-formed stack (older schema, corrupted storage, missing root).
export function restoreStack(raw: unknown): ViewStack {
  if (!Array.isArray(raw) || raw.length === 0) return ROOT_STACK;
  if (!raw.every(isPanelView)) return ROOT_STACK;
  if ((raw[0] as PanelView).kind !== "list") return ROOT_STACK;
  return { views: raw as PanelView[] };
}
