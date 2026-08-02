import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { ExtensionContext } from "@silo-code/sdk";

export interface GithubMarkdownProps {
  ctx: ExtensionContext;
  children: string;
}

// react-markdown treats embedded raw HTML as inert text by default (which is
// why a bot-generated review — Cursor Bugbot's, notably, which wraps its
// output in raw <picture>/<sup>/<details> tags — showed up as literal
// "<!-- BUGBOT_REVIEW -->" source instead of rendering). rehype-raw turns
// that raw HTML back into real nodes; rehype-sanitize strips anything unsafe
// from the result before it reaches the DOM (this content is arbitrary
// GitHub PR review/description text — any external contributor's — so it's
// as untrusted as it gets). Extends the default schema (already modeled on
// GitHub's own markdown allowlist, which is why picture/source/sup/details
// already pass) only to keep `alt` on images, which the default schema drops.
const SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    img: [...(defaultSchema.attributes?.img ?? []), "alt"],
  },
};

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
        rehypePlugins={[rehypeRaw, [rehypeSanitize, SANITIZE_SCHEMA]]}
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
