/**
 * A hover **preview card** — the same 600ms-delay / viewport-clamp mechanics
 * as the SDK `Tooltip`, but the popup is arbitrary JSX (`card`), not a
 * one-line string. Used for the task list's row hover (`TaskHoverCard`); the
 * SDK `Tooltip` stays the choice for plain text hints everywhere else.
 * Display-only — `pointer-events: none`, so it never steals the hover.
 *
 * The popup is a `position: fixed` sibling, not a portal: the host shares only
 * `react`/`react/jsx-runtime`/`@silo-code/sdk` with extensions, not
 * `react-dom`, so `createPortal` isn't available here. `fixed` still escapes
 * the scroll container's `overflow`, and none of the panel's ancestors carry
 * a persistent `transform`/`filter` that would trap it.
 *
 * The trigger wrapper keeps the SDK's `.silo-tooltip-host` class (inline-flex,
 * host-provided) so callers style it as a flex child exactly as with `Tooltip`.
 */

import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

const DELAY_MS = 600;
const GAP_PX = 6;
const MARGIN_PX = 8;

interface Anchor {
  cx: number;
  top: number;
  bottom: number;
}

export function HoverCard({
  card,
  children,
}: {
  card: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    timer.current = setTimeout(() => {
      const r = ref.current?.getBoundingClientRect();
      if (r) {
        setAnchor({
          cx: r.left + r.width / 2,
          top: r.top - GAP_PX,
          bottom: r.bottom + GAP_PX,
        });
      }
    }, DELAY_MS);
  };

  const hide = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setAnchor(null);
  };

  return (
    <span
      ref={ref}
      className="silo-tooltip-host"
      onMouseEnter={show}
      onMouseLeave={hide}
      onPointerDown={hide}
    >
      {children}
      {anchor && <CardPopup anchor={anchor}>{card}</CardPopup>}
    </span>
  );
}

function CardPopup({
  anchor,
  children,
}: {
  anchor: Anchor;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<{
    left?: number;
    top?: number;
    visibility: "hidden" | "visible";
  }>({ visibility: "hidden" });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.max(
      MARGIN_PX,
      Math.min(anchor.cx - w / 2, window.innerWidth - w - MARGIN_PX),
    );
    // Prefer above the row; drop below when there isn't room.
    const top = anchor.top - h < MARGIN_PX ? anchor.bottom : anchor.top - h;
    setStyle({ left, top, visibility: "visible" });
  }, [anchor]);

  return (
    <div ref={ref} className="tasks-hovercard" style={style}>
      {children}
    </div>
  );
}
