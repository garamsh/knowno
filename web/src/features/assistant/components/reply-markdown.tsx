import type { ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/** The Markdown 말랑이's reply is read as: CommonMark with GFM's tables, strikethrough and bare links (ADR 0227). */
export const replyRemarkPlugins = [remarkGfm];

/** What a link may open: the phone's set; any other scheme is text. */
const linkSchemes = new Set(["http:", "https:", "mailto:"]);

function linkOpens(href: string): boolean {
  try {
    return linkSchemes.has(new URL(href).protocol);
  } catch {
    return false;
  }
}

/** A heading is a line of the reply, not of the page: one level below the page's own headings. */
function heading(level: number) {
  return function Heading({ children }: { children?: ReactNode }) {
    return (
      <div
        role="heading"
        aria-level={Math.min(level + 2, 6)}
        className={level <= 2 ? "text-headline" : "text-body-strong"}
      >
        {children}
      </div>
    );
  };
}

const components: Components = {
  h1: heading(1),
  h2: heading(2),
  h3: heading(3),
  h4: heading(4),
  h5: heading(5),
  h6: heading(6),
  p: ({ children }) => <p className="break-keep whitespace-pre-wrap">{children}</p>,
  a: ({ href, children }) =>
    href !== undefined && linkOpens(href) ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all text-primary-edge underline"
      >
        {children}
      </a>
    ) : (
      <>{children}</>
    ),
  img: ({ alt }) => <span>{alt}</span>,
  ul: ({ children }) => <ul className="flex list-disc flex-col gap-1 ps-6">{children}</ul>,
  ol: ({ children }) => <ol className="flex list-decimal flex-col gap-1 ps-6">{children}</ol>,
  li: ({ children }) => <li className="flex flex-col gap-1">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="flex flex-col gap-2 border-s-4 border-outline ps-3 text-ink-2">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-hairline" />,
  code: ({ className, children }) =>
    className?.startsWith("language-") ? (
      <code className="font-mono">{children}</code>
    ) : (
      <code className="rounded-chip bg-ground px-1 font-mono">{children}</code>
    ),
  pre: ({ children }) => (
    // A scroll region is reachable from the keyboard.
    <pre
      tabIndex={0}
      className="overflow-x-auto rounded-row bg-ground p-3 whitespace-pre focus-visible:outline-2"
    >
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div
      role="region"
      aria-label="표"
      tabIndex={0}
      className="overflow-x-auto focus-visible:outline-2"
    >
      <table className="border-collapse border border-hairline">{children}</table>
    </div>
  ),
  th: ({ children, style }) => (
    <th style={style} className="border border-hairline bg-ground px-2 py-1 text-start font-bold">
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="border border-hairline px-2 py-1">
      {children}
    </td>
  ),
};

/** The one place a link's address is judged: an address the set does not open is dropped, so `a` draws text. */
function urlTransform(url: string): string {
  return linkOpens(url) ? url : "";
}

/** 말랑이's reply text drawn from its Markdown with the design tokens; no raw HTML is read, no image is fetched. */
export default function ReplyMarkdown({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-2 text-body">
      <Markdown
        remarkPlugins={replyRemarkPlugins}
        components={components}
        urlTransform={urlTransform}
      >
        {text}
      </Markdown>
    </div>
  );
}
