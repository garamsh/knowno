import type { ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { type ClozeSpan, MarkupRuns, MarkupText } from "@/design/markup-text";
import { parse } from "@/design/markup-engine";
import { useMarkupReady } from "@/design/use-markup-ready";

/** The Markdown 말랑이's reply is read as: CommonMark with GFM's tables, strikethrough and bare links (ADR 0227). */
export const replyRemarkPlugins = [remarkGfm];

/** A cloze of the card markup as a blank, its hint after it, as a proposal's card shows it. */
function blank(span: ClozeSpan): ReactNode {
  return (
    <span data-blank="reply" className="rounded-sm bg-brand-tint px-1">
      {span.hint === null ? "___" : `___(${span.hint})`}
    </span>
  );
}

/** [text] with each line's first list marker made literal, as the card markup's escape does (`escape` in `engine/src/markup.rs`). */
function literalMarkers(text: string): string {
  return text.replace(/^(?=-|\d+\.)/gm, "\\");
}

/**
 * A text of the reply that holds cloze syntax, read by the engine and drawn as a card draws it. A
 * line of the reply that starts `3. ` is the reply's words, not a list, so its marker is escaped
 * and the text reads as one paragraph.
 */
function ReplyCloze({ source }: { source: string }) {
  const ready = useMarkupReady();
  if (!ready) return source;
  const blocks = parse(literalMarkers(source));
  const [only, ...more] = blocks;
  return only?.type === "paragraph" && more.length === 0 ? (
    <MarkupRuns content={only.content} cloze={blank} />
  ) : (
    <MarkupText document={blocks} cloze={blank} />
  );
}

/** A rehype plugin: each text holding `{{` outside code becomes a span the engine reads. */
function clozeTexts() {
  const walk = (node: LineNode) => {
    if (node.tagName === "code" || node.tagName === "pre") return;
    node.children = node.children?.map((child) => {
      if (child.type === "text" && child.value?.includes("{{") === true)
        return {
          type: "element",
          tagName: "span",
          properties: { dataClozeSource: child.value },
          children: [],
        };
      walk(child);
      return child;
    });
  };
  return walk;
}

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

/** The `span` that [clozeTexts] leaves where a text holds cloze syntax. */
function ClozeSpan({ children, ...props }: { children?: ReactNode }) {
  const source: unknown = (props as Record<string, unknown>)["data-cloze-source"];
  return typeof source === "string" ? <ReplyCloze source={source} /> : <span>{children}</span>;
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
  span: ClozeSpan,
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
        rehypePlugins={[clozeTexts]}
        components={components}
        urlTransform={urlTransform}
      >
        {text}
      </Markdown>
    </div>
  );
}

/** The part of a syntax tree the line reads: `react-markdown` hands its plugins a hast tree. */
type LineNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: LineNode[];
};

/** Elements that end a line of the reply or a cell of a row: a space stands where they end. */
const lineBreaks = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "br",
  "blockquote",
  "pre",
  "tr",
  "th",
  "td",
  "hr",
]);

function words(node: LineNode): string {
  if (node.type === "text" || node.type === "raw") return node.value ?? "";
  if (node.type !== "element" && node.type !== "root") return "";
  // A footnote's list is the reader's to follow, not a remark's words.
  if (node.tagName === "section") return "";
  if (node.tagName === "img")
    return typeof node.properties?.alt === "string" ? node.properties.alt : "";
  const inside = (node.children ?? []).map(words).join("");
  return node.tagName !== undefined && lineBreaks.has(node.tagName) ? ` ${inside} ` : inside;
}

/** A rehype plugin: the whole tree becomes one text node, the reply's words folded to a line. */
function intoLine() {
  return (tree: LineNode) => {
    const value = words(tree).replace(/\s+/g, " ").trim();
    tree.children = [
      value.includes("{{")
        ? {
            type: "element",
            tagName: "span",
            properties: { dataClozeSource: value },
            children: [],
          }
        : { type: "text", value },
    ];
  };
}

/**
 * 말랑이's interim remark as the words the reply would show for it, on one line: read with the
 * reply's parser and extension set, no mark left, a link as its text, an image as its alt text.
 */
export function ReplyLine({ text }: { text: string }) {
  return (
    <Markdown
      remarkPlugins={replyRemarkPlugins}
      rehypePlugins={[intoLine]}
      components={{ span: ClozeSpan }}
    >
      {text}
    </Markdown>
  );
}
