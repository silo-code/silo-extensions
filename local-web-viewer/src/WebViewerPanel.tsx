import { useEffect, useRef, useState } from "react";
import type { DockPanelProps, ExtensionContext, WebFrame } from "@silo-code/sdk";
import { Tooltip } from "@silo-code/sdk";
import {
  ArrowClockwise,
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  Camera,
  Cursor,
  ProhibitInset,
  WifiX,
} from "@phosphor-icons/react";
import { normalizeUrl, tabTitleFromUrl, isLocalUrl, parseTitleFromHtml } from "./local-web-viewer-model";
import { AnnotationModal } from "./AnnotationModal";

interface LocalWebViewerParams {
  /** Full navigation stack, oldest first. Source of truth for back/forward — see HistoryState. */
  history?: string[];
  /** Current position within `history`. */
  historyIndex?: number;
  /** @deprecated Pre-history-stack persisted shape; still read as a fallback for panels saved before this field existed. */
  url?: string;
  title?: string;
}

interface Props extends DockPanelProps<LocalWebViewerParams> {
  ctx: ExtensionContext;
}

interface Marquee {
  startX: number;
  startY: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

// The browser DOM has no canGoBack/canGoForward query, and a freshly (re)created
// iframe — after a workspace switch or app restart — has no real session
// history to fall back on anyway. So this is the source of truth for both
// button-enabled state and navigation, persisted verbatim via updateParameters;
// `frame.back()`/`forward()` (real iframe session history) are unused here.
interface HistoryState {
  entries: string[];
  index: number;
}

function initialHistoryState(params: LocalWebViewerParams | undefined): HistoryState {
  if (params?.history && params.history.length > 0) {
    const index = params.historyIndex ?? params.history.length - 1;
    return { entries: params.history, index: Math.min(Math.max(index, 0), params.history.length - 1) };
  }
  if (params?.url) return { entries: [params.url], index: 0 };
  return { entries: [], index: -1 };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

const DEFAULT_TITLE = "Web View";

export function LocalWebViewerPanel({ api, params, ctx }: Props) {
  const [historyState, setHistoryState] = useState<HistoryState>(() => initialHistoryState(params));
  const url = historyState.index >= 0 ? historyState.entries[historyState.index] : "";
  const canGoBack = historyState.index > 0;
  const canGoForward = historyState.index >= 0 && historyState.index < historyState.entries.length - 1;

  const [addressBar, setAddressBar] = useState(url);
  const [blocked, setBlocked] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  const [checking, setChecking] = useState(false);
  const [picking, setPicking] = useState(false);
  const [marqueeMode, setMarqueeMode] = useState(false);
  const [marquee, setMarquee] = useState<Marquee | null>(null);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const frameRef = useRef<WebFrame | null>(null);
  const cameraButtonRef = useRef<HTMLButtonElement>(null);
  const marqueeOverlayRef = useRef<HTMLDivElement>(null);
  // Mirrors `marquee` state for the window-level drag listeners. Updated
  // synchronously alongside every setMarquee call so that finishMarquee
  // always reads the latest drag position — a useEffect sync would lag by
  // one render cycle and give captureRect a stale (wrong) rect.
  const marqueeRef = useRef<Marquee | null>(null);
  // The mount effect (and goToIndex when called from it) closes over the
  // initial state — this ref gives those call sites the current historyState.
  // Note: onNavigate deliberately does NOT read it; nav events can arrive
  // within one render flush of each other, so it works off setHistoryState's
  // `prev` instead.
  const historyStateRef = useRef(historyState);
  historyStateRef.current = historyState;
  // Set immediately before we assign iframe.src ourselves (navigateToNew /
  // goToIndex), consumed by the first onNavigate event of the next fresh
  // document (e.newDocument) — NOT by whichever event arrives first, since a
  // single full-page load reports several. Distinguishes "we triggered this"
  // from a link click / SPA route change / redirect inside the page —
  // comparing URL strings doesn't work because the browser can normalize the
  // URL we set (e.g. add a trailing slash) before reporting it back, which
  // would otherwise look like a brand-new destination.
  const pendingOwnNavRef = useRef(false);
  // Bumped on every onNavigate event; each title fetch captures its own
  // value and checks it back before applying. A single page transition
  // reports multiple events (see isOwnNav's comment above), each firing its
  // own async document.title fetch — without this guard, an earlier event's
  // fetch resolving after a later event's would clobber the correct title
  // with a stale one.
  const navTokenRef = useRef(0);
  // A single page transition reports multiple onNavigate events (boot-time
  // replaceState + load, etc. — see isOwnNav's comment above) that all carry
  // the same final URL; logging every one of them would print duplicate
  // lines for what the user experiences as one navigation. Only log when
  // the URL actually changes from the last one logged.
  const lastLoggedUrlRef = useRef<string | null>(null);
  // Guards async title work (frame.exec, the delayed re-check, the local-URL
  // HTML fetch) against firing after the panel has unmounted and its frame
  // has been disposed.
  const disposedRef = useRef(false);
  // Holds the pending setTimeout(applyTitle, 400) id so it can be cleared on
  // unmount — otherwise a navigation immediately followed by closing the
  // panel leaves a timer that fires after frame.dispose() has already run.
  const titleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist on every history change — survives workspace switches and app
  // restarts. `url`/`title` kept in sync too for anything still reading them.
  useEffect(() => {
    api.updateParameters({
      history: historyState.entries,
      historyIndex: historyState.index,
      url: url || undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyState]);

  // Bumped on every loadIntoFrame call; each call captures its own value and
  // checks it back in after the async reachability check. Back/Forward
  // clicked twice in quick succession starts two overlapping calls — without
  // this guard, whichever one's fetchHeaders resolves *last* would win,
  // regardless of which navigation the user actually landed on: a slow,
  // already-superseded call could still assign iframe.src (silently
  // navigating away from where the user is) or flip setUnreachable(true)
  // over a page that's already loaded and working.
  const loadTokenRef = useRef(0);

  // Reachability pre-check, then point the iframe at `target`. Does not touch
  // historyState — callers (navigateToNew / goToIndex) own that.
  async function loadIntoFrame(target: string) {
    const token = ++loadTokenRef.current;
    setBlocked(false);
    setUnreachable(false);
    setChecking(true);
    try {
      await ctx.net.fetchHeaders(target, { timeoutMs: 8000 });
    } catch (err) {
      if (loadTokenRef.current !== token) return; // superseded by a newer navigation
      setChecking(false);
      setUnreachable(true);
      ctx.log.warn(`Cannot reach ${target}`, err instanceof Error ? err.message : String(err));
      return;
    }
    if (loadTokenRef.current !== token) return; // superseded by a newer navigation
    setChecking(false);
    const iframe = iframeRef.current;
    if (iframe) {
      // Only flip the flag once we're actually about to navigate — if the
      // reachability check above had failed, no navigation happens and the
      // flag must stay false, or the *next* real navigation would wrongly
      // get treated as "ours" and skip being pushed.
      pendingOwnNavRef.current = true;
      iframe.src = target;
    }
  }

  // A genuinely new destination — truncate any forward history (matches
  // standard browser behavior: navigating away from a back-state drops what
  // was ahead of it), push, and load.
  function navigateToNew(target: string) {
    setHistoryState((prev) => {
      const truncated = prev.entries.slice(0, prev.index + 1);
      return { entries: [...truncated, target], index: truncated.length };
    });
    void loadIntoFrame(target);
  }

  // Move within the existing stack (back/forward button, or restoring a
  // persisted session on mount) — no truncation, no push.
  function goToIndex(newIndex: number) {
    const hs = historyStateRef.current;
    if (newIndex < 0 || newIndex >= hs.entries.length) return;
    setHistoryState((prev) => ({ ...prev, index: newIndex }));
    void loadIntoFrame(hs.entries[newIndex]);
  }

  useEffect(() => {
    // Tabs otherwise start with an empty title — nothing sets one until the
    // first onNavigate fires, which never happens if the panel opens with no
    // URL. params?.title covers the "Local" default from addMenuItem/the open
    // command; DEFAULT_TITLE covers everything else (e.g. a saved layout
    // restoring a panel with no title recorded).
    api.setTitle(params?.title || DEFAULT_TITLE);
    disposedRef.current = false;

    const iframe = iframeRef.current;
    if (!iframe) return;
    const frame = ctx.webview.attach(iframe);
    frameRef.current = frame;

    const navSub = frame.onNavigate((e) => {
      setAddressBar(e.url);
      setBlocked(false);

      if (e.url !== lastLoggedUrlRef.current) {
        lastLoggedUrlRef.current = e.url;
        ctx.log.info(`Navigated to ${e.url}`);
      }

      // One full-page navigation reports several events (frameworks call
      // replaceState while booting, then the window "load" fires), so the
      // own-nav flag can't be consumed by whichever event happens to arrive
      // first — that left the trailing "load" looking user-initiated, which
      // pushed a duplicate entry and broke the second consecutive Back. The
      // flag belongs to exactly one thing: the first event of the next fresh
      // document (our iframe.src assignment always creates one).
      const isOwnNav = e.newDocument && pendingOwnNavRef.current;
      if (e.newDocument) pendingOwnNavRef.current = false;

      // All stack decisions live inside the updater: events can arrive
      // closer together than a render flush, so anything read outside prev
      // (historyStateRef included) may be one event behind.
      setHistoryState((prev) => {
        const current = prev.index >= 0 ? prev.entries[prev.index] : null;

        // Re-report of where we already are — the "load" that trails a
        // boot-time replaceState, or a reload. Never a new entry.
        if (current === e.url) return prev;

        // First navigation in a panel that had no stack yet.
        if (prev.index < 0) return { entries: [e.url], index: 0 };

        const rewriteInPlace =
          // Our own navigation landing at a normalized/redirected URL —
          // reconcile the entry we already moved to, don't push a duplicate.
          isOwnNav ||
          // A genuine in-page replaceState rewrites the current entry by
          // definition. A boot-time replace (newDocument) of a page we did
          // NOT load ourselves is different: that's a user-initiated
          // full-page navigation reporting early, handled by the push below.
          (e.type === "replace" && !e.newDocument);

        if (rewriteInPlace) {
          const entries = [...prev.entries];
          entries[prev.index] = e.url;
          return { ...prev, entries };
        }

        // popstate = the page traversed its own session history — mirror the
        // move within our stack instead of pushing, when the target lines
        // up. Not necessarily adjacent: a page can call history.go(-2) and
        // report a single pop event several slots away. Search the whole
        // stack and prefer the occurrence closest to where we are now, in
        // case the same URL appears more than once.
        if (e.type === "pop") {
          let matchIndex = -1;
          let matchDist = Infinity;
          prev.entries.forEach((entry, i) => {
            if (entry !== e.url) return;
            const dist = Math.abs(i - prev.index);
            if (dist < matchDist) {
              matchDist = dist;
              matchIndex = i;
            }
          });
          if (matchIndex >= 0) return { ...prev, index: matchIndex };
        }

        // A navigation the user caused inside the page — link click, SPA
        // route change, redirect. Push, truncating any forward history.
        const truncated = prev.entries.slice(0, prev.index + 1);
        return { entries: [...truncated, e.url], index: truncated.length };
      });

      const fallbackTitle = tabTitleFromUrl(e.url);
      api.setTitle(fallbackTitle);
      const token = ++navTokenRef.current;

      // Cross-origin exec failure (or an empty <title>) leaves nothing but
      // the hostname-derived fallback — for local URLs (localhost, *.local,
      // file://) try a server-side fetch-and-parse instead. Skipped for
      // external sites since many return WAF/bot-block pages to non-browser
      // user-agents, which would show a wrong title.
      const applyLocalTitleFallback = async () => {
        if (!isLocalUrl(e.url)) return;
        try {
          const { body, headers } = await ctx.net.fetch(e.url, { timeoutMs: 3000 });
          if (disposedRef.current || navTokenRef.current !== token) return;
          const contentType = headers["content-type"] ?? "";
          if (!contentType.includes("text/html")) return;
          const fetched = parseTitleFromHtml(body);
          if (!fetched) return;
          api.setTitle(fetched);
          api.updateParameters({ title: fetched });
        } catch {
          /* ignore — hostname-derived fallback title already set */
        }
      };

      const applyTitle = () => {
        frame
          .exec<string>("document.title")
          .then((title) => {
            // A newer navigation has since started — this response belongs
            // to a page we've already left; applying it would show that
            // page's (possibly not-yet-updated) title over the current one.
            // Also bail if the panel has since unmounted.
            if (disposedRef.current || navTokenRef.current !== token) return;
            const trimmed = title?.trim();
            if (trimmed) {
              api.setTitle(trimmed);
              api.updateParameters({ title: trimmed });
              return;
            }
            void applyLocalTitleFallback();
          })
          .catch(() => {
            void applyLocalTitleFallback();
          });
      };
      applyTitle();
      // SPA route changes (client-side, no full reload) can lazy-load the
      // destination page's <title> slightly after these nav events fire —
      // e.g. VitePress fetches the route's content chunk asynchronously —
      // so the immediate read above can catch the *previous* page's title
      // mid-transition. A full reload doesn't need this (the title is
      // already baked into the static HTML by the time "load" fires), but
      // re-checking unconditionally is harmless in that case.
      if (titleTimeoutRef.current !== null) clearTimeout(titleTimeoutRef.current);
      titleTimeoutRef.current = setTimeout(applyTitle, 400);
    });

    const blockedSub = frame.onBlocked(() => {
      setBlocked(true);
      const hs = historyStateRef.current;
      const blockedUrl = hs.index >= 0 ? hs.entries[hs.index] : "";
      ctx.log.warn(`Embedding blocked for ${blockedUrl}`);
    });

    // Restore: a freshly (re)created iframe has no browser history of its
    // own, so bringing back a persisted session is a real navigation, not a
    // "back" move — goToIndex to the already-restored current position.
    if (historyStateRef.current.index >= 0) {
      goToIndex(historyStateRef.current.index);
    }

    return () => {
      disposedRef.current = true;
      if (titleTimeoutRef.current !== null) clearTimeout(titleTimeoutRef.current);
      navSub.dispose();
      blockedSub.dispose();
      frame.dispose();
      frameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function refresh() {
    if (unreachable || blocked) {
      // Re-run the full reachability/navigation flow rather than a plain
      // iframe reload — this also picks up an address bar the user edited
      // but never pressed Enter for, instead of silently re-loading the
      // stale blocked/unreachable URL.
      if (addressBar) void loadIntoFrame(addressBar);
      return;
    }
    if (!url) return;
    frameRef.current?.reload();
  }

  function handleError() {
    setUnreachable(true);
  }

  async function captureAndAnnotate(getBlob: () => Promise<Blob>) {
    try {
      const blob = await getBlob();
      const dataUrl = await blobToDataUrl(blob);
      void ctx.ui.showModal(
        (close) => <AnnotationModal dataUrl={dataUrl} close={close} />,
        { title: "Screenshot", dismissible: true, size: "lg" },
      );
    } catch (err) {
      ctx.log.error("Screenshot failed", err instanceof Error ? err.message : String(err));
      ctx.log.show();
      ctx.ui.notify("error", "Screenshot failed — see Output for details.");
    }
  }

  async function captureElementImage() {
    const frame = frameRef.current;
    if (!frame) return;
    const picked = await frame.pickElement();
    if (!picked) return;
    await captureAndAnnotate(() => frame.captureRect(picked.rect));
  }

  function openCameraMenu() {
    const frame = frameRef.current;
    if (!frame) return;
    void ctx.ui.showMenu({
      items: [
        { label: "Visible area", run: () => void captureAndAnnotate(() => frame.capture()) },
        { label: "Full page", run: () => void captureAndAnnotate(() => frame.captureFullPage()) },
        { label: "Select region", run: () => setMarqueeMode(true) },
        { label: "Capture element", run: () => void captureElementImage() },
      ],
      anchor: cameraButtonRef.current ?? undefined,
      align: "end",
    });
  }

  async function pickElementForPrompt() {
    const frame = frameRef.current;
    if (!frame || picking) return;
    setPicking(true);
    try {
      const picked = await frame.pickElement();
      if (picked) {
        const snippet = picked.text ? ` (it says "${picked.text}")` : "";
        const prompt = `\`${picked.selector}\`${snippet}`;
        await navigator.clipboard.writeText(prompt);
        ctx.ui.notify("info", "Copied to clipboard.");
      }
    } catch {
      ctx.ui.notify("error", "Copy failed.");
    } finally {
      setPicking(false);
    }
  }

  function marqueePoint(clientX: number, clientY: number) {
    const rect = marqueeOverlayRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  }

  function onMarqueeDown(e: React.MouseEvent<HTMLDivElement>) {
    if (!marqueeMode) return;
    e.preventDefault();
    const { x, y } = marqueePoint(e.clientX, e.clientY);
    const m = { startX: x, startY: y, x, y, width: 0, height: 0 };
    marqueeRef.current = m;
    setMarquee(m);
  }

  async function finishMarquee() {
    const m = marqueeRef.current;
    marqueeRef.current = null;
    setMarqueeMode(false);
    setMarquee(null);
    if (!m || m.width < 4 || m.height < 4) return;
    const rect = { x: m.x, y: m.y, width: m.width, height: m.height };
    const frame = frameRef.current;
    if (frame) await captureAndAnnotate(() => frame.captureRect(rect));
  }

  // The overlay only covers .lwv-content, so a drag that ends over the
  // toolbar (or anywhere outside the overlay's bounds) would never reach an
  // element-scoped mouseup handler, leaving marqueeMode stuck on with no way
  // to cancel it. Track the drag and allow Escape-to-cancel at the window
  // level instead, for the lifetime of an active selection.
  useEffect(() => {
    if (!marqueeMode) return;
    function onMove(e: MouseEvent) {
      const { x, y } = marqueePoint(e.clientX, e.clientY);
      setMarquee((m) => {
        if (!m) return m;
        const next = {
          ...m,
          x: Math.min(m.startX, x),
          y: Math.min(m.startY, y),
          width: Math.abs(x - m.startX),
          height: Math.abs(y - m.startY),
        };
        marqueeRef.current = next;
        return next;
      });
    }
    function onUp() {
      // Window-level, so this also catches the tail of the very click that
      // armed marquee mode from the camera menu — arriving before any drag
      // has started. Only a mousedown on the overlay begins a drag (sets
      // marqueeRef); finishing on any earlier mouseup would instantly
      // disarm the mode.
      if (!marqueeRef.current) return;
      void finishMarquee();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        marqueeRef.current = null;
        setMarqueeMode(false);
        setMarquee(null);
      }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marqueeMode]);

  return (
    <div className="lwv">
      <div className="lwv-bar">
        <Tooltip content="Back">
          <button
            className="lwv-btn"
            onClick={() => goToIndex(historyState.index - 1)}
            disabled={!canGoBack}
          >
            <ArrowLeft weight="bold" size={13} />
          </button>
        </Tooltip>
        <Tooltip content="Forward">
          <button
            className="lwv-btn"
            onClick={() => goToIndex(historyState.index + 1)}
            disabled={!canGoForward}
          >
            <ArrowRight weight="bold" size={13} />
          </button>
        </Tooltip>
        <Tooltip content="Refresh">
          <button
            className="lwv-btn"
            onClick={refresh}
            disabled={!addressBar || checking}
          >
            <ArrowClockwise weight="bold" size={13} />
          </button>
        </Tooltip>
        <input
          className="lwv-url-input"
          type="text"
          value={addressBar}
          onChange={(e) => setAddressBar(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const normalized = normalizeUrl(addressBar);
              if (normalized) {
                setAddressBar(normalized);
                navigateToNew(normalized);
              }
            }
            if (e.key === "Escape") setAddressBar(url);
          }}
          onFocus={(e) => e.target.select()}
          placeholder="Enter a URL and press Enter"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        {url && (
          <>
            <Tooltip content="Open in browser">
              <button
                className="lwv-btn"
                onClick={() => void ctx.ui.openExternal(url)}
              >
                <ArrowSquareOut weight="bold" size={13} />
              </button>
            </Tooltip>
            <Tooltip content="Screenshot">
              <button
                ref={cameraButtonRef}
                className="lwv-btn"
                onClick={openCameraMenu}
              >
                <Camera weight="bold" size={13} />
              </button>
            </Tooltip>
            <Tooltip content={picking ? "Picking… (Esc to cancel)" : "Pick element"}>
              <button
                className={`lwv-btn${picking ? " lwv-btn-active" : ""}`}
                onClick={() => void pickElementForPrompt()}
                disabled={picking}
              >
                <Cursor weight="bold" size={13} />
              </button>
            </Tooltip>
          </>
        )}
      </div>
      <div className="lwv-content">
        <iframe
          ref={iframeRef}
          className="lwv-frame"
          style={marqueeMode ? { pointerEvents: "none" } : undefined}
          onError={handleError}
          title="Local Web Viewer"
        />
        {marqueeMode && (
          <div
            ref={marqueeOverlayRef}
            className="lwv-marquee-overlay"
            onMouseDown={onMarqueeDown}
          >
            {marquee && (
              <div
                className="lwv-marquee"
                style={{
                  left: marquee.x,
                  top: marquee.y,
                  width: marquee.width,
                  height: marquee.height,
                }}
              />
            )}
          </div>
        )}
        {!url && !checking && !blocked && !unreachable && (
          <div className="lwv-empty">
            <span>Enter a URL and press Enter.</span>
          </div>
        )}
        {checking && (
          <div className="lwv-overlay">
            <div className="lwv-spinner" />
          </div>
        )}
        {unreachable && (
          <div className="lwv-overlay">
            <WifiX size={32} weight="duotone" />
            <p>Can&apos;t reach this address.</p>
          </div>
        )}
        {blocked && (
          <div className="lwv-overlay">
            <ProhibitInset size={32} weight="duotone" />
            <p>This page doesn&apos;t allow embedding.</p>
            <button
              className="lwv-open-external"
              onClick={() => void ctx.ui.openExternal(addressBar)}
            >
              <ArrowSquareOut size={13} weight="bold" />
              Open in Browser
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
