import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { ExtensionContext } from "@silo-code/sdk";
import { GithubMarkdown } from "./GithubMarkdown";

function mockCtx(): ExtensionContext {
  return {
    ui: { openExternal: () => Promise.resolve() },
  } as unknown as ExtensionContext;
}

function render(body: string): string {
  return renderToStaticMarkup(<GithubMarkdown ctx={mockCtx()}>{body}</GithubMarkdown>);
}

describe("GithubMarkdown", () => {
  it("renders plain markdown normally", () => {
    const html = render("**bold** and a [link](https://example.com)");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain(">link</a>");
  });

  // Regression: a bot review (Cursor Bugbot) wraps its output in raw HTML
  // comments and tags — without rehype-raw, react-markdown treats embedded
  // HTML as inert text, so this showed up as literal "<!-- BUGBOT_REVIEW
  // -->" source instead of rendering.
  it("renders embedded raw HTML instead of showing it as literal text", () => {
    const html = render("<!-- BUGBOT_REVIEW -->\nCursor Bugbot found 1 issue.\n<sup>footnote</sup>");
    expect(html).not.toContain("BUGBOT_REVIEW");
    expect(html).toContain("Cursor Bugbot found 1 issue.");
    expect(html).toContain("<sup>footnote</sup>");
  });

  it("renders GitHub-style structural tags (picture/details/summary)", () => {
    const html = render(
      '<picture><source media="(prefers-color-scheme: dark)" srcset="https://x.com/dark.png"><img alt="Fix in Cursor" src="https://x.com/light.png"></picture>\n\n' +
        "<details>\n<summary>More</summary>\n\nhidden text\n\n</details>",
    );
    expect(html).toContain("<picture>");
    expect(html).toContain("<details>");
    expect(html).toContain("<summary>More</summary>");
    expect(html).toContain('alt="Fix in Cursor"');
  });

  // This content is arbitrary GitHub PR review/description text — any
  // external contributor's — so it's as untrusted as it gets. A dangerous
  // string not appearing *anywhere* in the rendered output (not just hidden
  // behind our own href="#" trick) proves it never survives long enough to
  // reach our components, let alone the DOM.
  it("strips <script> tags", () => {
    const html = render("before\n<script>alert('xss')</script>\nafter");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(");
  });

  it("strips inline event-handler attributes", () => {
    const html = render('<img src="https://x.com/a.png" onerror="alert(1)">');
    expect(html).not.toContain("onerror");
  });

  it("strips a javascript: href entirely, not just masks it", () => {
    const html = render('<a href="javascript:alert(1)">evil</a>');
    expect(html).not.toContain("javascript:");
  });
});

// GithubMarkdown's own `a`/`img` overrides always render a static href="#"
// (the real target is only ever read inside the onClick closure, which
// renderToStaticMarkup can't observe), so the tests above can't tell a safe
// https link that made it through sanitize from one sanitize stripped —
// both look identical in that component's output. This exercises the same
// remark/rehype pipeline directly with a test-only override that *does*
// expose what each prop actually received, to confirm the schema itself
// preserves safe URLs rather than only stripping unsafe ones (over-eager
// sanitization would silently break every real link in a review/description).
describe("sanitize schema (pipeline-level)", () => {
  const SCHEMA = {
    ...defaultSchema,
    attributes: {
      ...defaultSchema.attributes,
      img: [...(defaultSchema.attributes?.img ?? []), "alt"],
    },
  };

  function renderRaw(body: string): string {
    return renderToStaticMarkup(
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, SCHEMA]]}
        components={{
          a: ({ href, children }) => <a data-href={href ?? "(stripped)"}>{children}</a>,
        }}
      >
        {body}
      </Markdown>,
    );
  }

  it("preserves a safe https href", () => {
    expect(renderRaw('<a href="https://example.com/page">safe</a>')).toContain(
      'data-href="https://example.com/page"',
    );
  });

  it("strips an unsafe javascript: href", () => {
    expect(renderRaw('<a href="javascript:alert(1)">evil</a>')).toContain('data-href="(stripped)"');
  });
});
