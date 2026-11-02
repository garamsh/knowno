import { readFileSync } from "node:fs";
import path from "node:path";

const globalsCss = readFileSync(path.join(import.meta.dirname, "../styles/globals.css"), "utf8");

/** Each type style of globals.css by name, in px. */
const styles = new Map(
  [...(/@theme \{([^}]*)\}/.exec(globalsCss)?.[1] ?? "").matchAll(/--text-([a-z-]+):\s*(\d+)px;/g)]
    .filter(([, name]) => !name?.includes("--"))
    .map(([, name, size]) => [String(name), Number(size)]),
);

/**
 * The styles a page's three sizes leave out (`design.md` §Details): a large figure, with its unit
 * after it, a card's own content, a button's label, and Google's button.
 */
const outside = new Set(["figure", "front", "back", "button", "google"]);

/** The type style [element] draws in: its own base `text-*` style, else its nearest ancestor's. */
function styleOf(element: Element | null): string | undefined {
  for (let at = element; at; at = at.parentElement) {
    const style = [...at.classList]
      .map((name) => /^text-([a-z-]+)$/.exec(name)?.[1])
      .find((name) => name !== undefined && styles.has(name));
    if (style) return style;
  }
  return undefined;
}

/**
 * The type sizes, in px, of the text drawn under [root] at a phone's width, smallest first: each
 * element's own text in its style, the browser's 16 where none is set, and none of a figure, a
 * figure's unit right after it, a card's content, a button's label, Google's button, text drawn for a screen reader
 * alone or text hidden at a phone's width.
 */
export function typeSizesOf(root: Element): number[] {
  const sizes = new Set<number>();
  for (const element of [root, ...root.querySelectorAll("*")]) {
    const own = [...element.childNodes].some(
      (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "",
    );
    if (!own || element.closest(".sr-only, .hidden")) continue;
    const style = styleOf(element);
    if (style !== undefined && outside.has(style)) continue;
    if (styleOf(element.previousElementSibling) === "figure") continue;
    sizes.add(style === undefined ? 16 : (styles.get(style) ?? 16));
  }
  return [...sizes].sort((a, b) => a - b);
}
