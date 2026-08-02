import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ExtensionContext } from "@silo-code/sdk";

export interface GithubMarkdownProps {
  ctx: ExtensionContext;
  children: string;
}

/** Renders GitHub-flavored markdown (PR descriptions, review bodies) with
 * links routed through `ctx.ui.openExternal` (never a real `href` — this
 * runs inside the panel, not a browser) and only `https` images allowed (a
 * relative/file-scheme `src` wouldn't resolve to anything here). Shared so
 * PrDetailView's Description section and PrReviewView don't each
 * reimplement the same link/image contract. */
export function GithubMarkdown({ ctx, children }: GithubMarkdownProps) {
  return (
    <div className="ghpr-md">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: linkChildren }) => (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                if (href) void ctx.ui.openExternal(href);
              }}
            >
              {linkChildren}
            </a>
          ),
          img: ({ src, alt }) =>
            typeof src === "string" && /^https?:\/\//.test(src) ? (
              <img src={src} alt={alt ?? ""} />
            ) : null,
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}
