/**
 * Focus an element that may not be focusable yet. On a fresh
 * `openPanelSheet` the surface is `visibility: hidden` for a frame or two
 * while the host computes its placement, and `.focus()` is a silent no-op
 * until then. Retries across animation frames until focus takes (or ~20
 * frames pass). Returns a cleanup that cancels any pending retry — hand it
 * straight back from a `useEffect`.
 */
export function focusWhenReady(
  getEl: () => HTMLElement | null | undefined,
): () => void {
  let raf = 0;
  let tries = 0;
  const attempt = () => {
    const el = getEl();
    el?.focus();
    if (el && document.activeElement === el) return;
    if (tries++ < 20) raf = requestAnimationFrame(attempt);
  };
  raf = requestAnimationFrame(attempt);
  return () => cancelAnimationFrame(raf);
}
