import { useEffect, useRef, useState } from "react";
import type { DockPanelProps, ExtensionContext } from "@silo-code/sdk";
import { Tooltip } from "@silo-code/sdk";
import {
  ArrowClockwise,
  ArrowSquareOut,
  ProhibitInset,
  WifiX,
} from "@phosphor-icons/react";
import { normalizeUrl, tabTitleFromUrl, parseTitleFromHtml, isLocalUrl } from "./local-web-viewer-model";

interface LocalWebViewerParams {
  url?: string;
  title?: string;
}

interface Props extends DockPanelProps<LocalWebViewerParams> {
  ctx: ExtensionContext;
}

// Inspect response headers to determine whether a URL allows iframe embedding.
function isEmbeddingBlocked(headers: Record<string, string>): boolean {
  const xfo = headers["x-frame-options"]?.toLowerCase().trim();
  if (xfo === "deny" || xfo === "sameorigin") return true;

  const csp = headers["content-security-policy"]?.toLowerCase() ?? "";
  if (csp) {
    const directive = csp
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("frame-ancestors"));
    if (directive) {
      const value = directive.slice("frame-ancestors".length).trim();
      if (value === "'none'" || value === "'self'") return true;
    }
  }

  return false;
}

export function LocalWebViewerPanel({ api, params, ctx }: Props) {
  const initialUrl = params?.url ?? "";
  // Start url empty so the iframe doesn't render until load() sets it after
  // the HEAD embeddability check completes.
  const [url, setUrl] = useState("");
  const [addressBar, setAddressBar] = useState(initialUrl);
  const [blocked, setBlocked] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  const [checking, setChecking] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const blockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Check embeddability via a server-side HEAD request, then load if clear.
  async function load(target: string) {
    setBlocked(false);
    setUnreachable(false);
    setChecking(true);
    try {
      const headers = await ctx.net.fetchHeaders(target, { timeoutMs: 8000 });
      if (isEmbeddingBlocked(headers)) {
        setChecking(false);
        setBlocked(true);
        return;
      }
    } catch {
      // DNS failure, connection refused, timeout — the host is unreachable.
      setChecking(false);
      setUnreachable(true);
      return;
    }
    setChecking(false);
    setUrl(target);
    api.updateParameters({ url: target });
    startBlockTimer();
  }

  useEffect(() => {
    if (initialUrl) void load(initialUrl);
    return () => clearBlockTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearBlockTimer() {
    if (blockTimerRef.current !== null) {
      clearTimeout(blockTimerRef.current);
      blockTimerRef.current = null;
    }
  }

  // Fallback: some servers don't send blocking headers on HEAD but the iframe
  // still ends up blank (e.g. redirect to a blocked page). Give it 2 s.
  function startBlockTimer() {
    clearBlockTimer();
    blockTimerRef.current = setTimeout(() => {
      const frame = iframeRef.current;
      if (!frame) return;
      try {
        const href = frame.contentWindow?.location?.href;
        if (!href || href === "about:blank") setBlocked(true);
      } catch {
        // SecurityError means cross-origin content did load — we're fine.
      }
    }, 2000);
  }

  function refresh() {
    // When blocked or unreachable, re-run the full check against addressBar.
    if (blocked || unreachable) {
      if (addressBar) void load(addressBar);
      return;
    }
    if (!url) return;
    setBlocked(false);
    const frame = iframeRef.current;
    if (frame) frame.src = url;
    startBlockTimer();
  }

  function handleLoad() {
    clearBlockTimer();
    const frame = iframeRef.current;
    if (!frame) return;

    // Resolve the current URL and DOM title, tolerating cross-origin errors at
    // each step individually. WKWebView sometimes allows reading
    // contentWindow.location.href across localhost ports without throwing, so
    // we can't rely on a single try/catch to distinguish same- vs cross-origin.
    let href = url;
    let domTitle: string | null = null;

    try {
      const h = frame.contentWindow?.location?.href;
      if (!h || h === "about:blank") { setBlocked(true); return; }
      href = h;
    } catch { /* cross-origin — href stays as the last-known url state value */ }

    try {
      domTitle = frame.contentDocument?.title?.trim() || null;
    } catch { /* cross-origin — domTitle stays null */ }

    // Mirror same-origin in-frame navigation to the address bar.
    if (href !== url) {
      setAddressBar(href);
      setUrl(href);
    }

    const displayTitle = domTitle ?? tabTitleFromUrl(href);
    api.setTitle(displayTitle);
    api.updateParameters({ url: href, title: displayTitle });

    // For local URLs without a DOM title (empty, or cross-origin SPA), fetch
    // the static <title> server-side via ctx.net which bypasses CORS.
    // Skip external sites — WAFs return block pages to non-browser agents.
    if (!domTitle && isLocalUrl(href)) {
      void ctx.net
        .fetch(href, { timeoutMs: 3000 })
        .then(({ body, headers }) => {
          const ct = headers["content-type"] ?? "";
          if (!ct.includes("text/html")) return;
          const fetched = parseTitleFromHtml(body);
          if (!fetched) return;
          api.setTitle(fetched);
          api.updateParameters({ url: href, title: fetched });
        })
        .catch(() => {});
    }
  }

  function handleError() {
    clearBlockTimer();
    setUnreachable(true);
  }

  return (
    <div className="lwv">
      <div className="lwv-bar">
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
                void load(normalized);
              }
            }
            if (e.key === "Escape") setAddressBar(url);
          }}
          onFocus={(e) => e.target.select()}
          placeholder="Enter a local URL and press Enter"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        {url && (
          <Tooltip content="Open in browser">
            <button
              className="lwv-btn"
              onClick={() => void ctx.ui.openExternal(url)}
            >
              <ArrowSquareOut weight="bold" size={13} />
            </button>
          </Tooltip>
        )}
      </div>
      <div className="lwv-content">
        {!url && !checking && !blocked && !unreachable ? (
          <div className="lwv-empty">
            <span>Enter a local URL and press Enter.</span>
          </div>
        ) : (
          <>
            {url && (
              <iframe
                ref={iframeRef}
                className="lwv-frame"
                src={url}
                onLoad={handleLoad}
                onError={handleError}
                title="Local Web Viewer"
              />
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
          </>
        )}
      </div>
    </div>
  );
}
