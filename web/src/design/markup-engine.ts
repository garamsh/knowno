import init, {
  type Block,
  clozeNumbers as engineClozeNumbers,
  escapeLiteral as engineEscapeLiteral,
  type Inline,
  initSync,
  parseMarkup,
  plainText as enginePlainText,
} from "./engine-wasm/knowno_engine_wasm.js";

export type { Block, Inline };

/**
 * The engine's one parser of card text markup and Anki cloze (ADR 0202, ADR 0208), through the
 * WebAssembly module `engine-wasm/pkg/` holds. This file is the web's only reader of the markup:
 * nothing here, or anywhere under `web/`, parses it. The module is the one the study feature
 * loads for scheduling, linked a second time here because a foundation imports no feature.
 *
 * The calls are synchronous, so the module must be loaded: the browser loads it as this file is
 * imported, and the server instantiates it from its file on the first call
 * (`markup-engine-server.ts`). A call before either is a programming error and throws, as the
 * phone's does without an installed engine.
 */

/** A card text read by the engine, with what a screen draws and what the card key is made of. */
export type Marked = {
  /** The text's blocks: paragraphs and lists, their marks and their cloze spans. */
  document: Block[];
  /** The text with marks removed and every cloze filled: what describes the text and keys a card. */
  plain: string;
};

let ready = false;
let loading: Promise<void> | undefined;
let serverLoad: (() => void) | undefined;
const listeners = new Set<() => void>();

/** Whether the module has loaded. */
export function markupLoaded(): boolean {
  return ready;
}

/**
 * Loads the module in the browser once per page; a failed load is tried again by the next call.
 * The server's call instantiates it from its file in `markup-engine-server.ts` instead.
 */
export function loadMarkupEngine(): Promise<void> {
  loading ??= init().then(
    () => {
      ready = true;
      for (const listener of listeners) listener();
    },
    (error: unknown) => {
      loading = undefined;
      throw error;
    },
  );
  return loading;
}

/** Registers the server's synchronous load, which [engine] calls where the module is not loaded. */
export function setServerMarkupLoad(load: () => void): void {
  serverLoad = load;
}

/** Instantiates the module from its [bytes], as the server and the tests do. */
export function installMarkupModule(bytes: BufferSource): void {
  if (ready) return;
  initSync({ module: bytes });
  ready = true;
  for (const listener of listeners) listener();
}

/** Calls [listener] once the module has loaded; returns what stops it, and starts the load. */
export function onMarkupLoaded(listener: () => void): () => void {
  listeners.add(listener);
  if (!ready) loadMarkupEngine().catch(() => undefined);
  return () => {
    listeners.delete(listener);
  };
}

function engine(): void {
  if (!ready) serverLoad?.();
  if (!ready) throw new Error("the markup engine is not loaded: call loadMarkupEngine first");
}

/** [text] as the engine's blocks. Total: no text is refused. */
export function parse(text: string): Block[] {
  engine();
  return parseMarkup(text);
}

/** The cloze numbers [text] holds, ascending, each once. */
export function clozeNumbers(text: string): number[] {
  engine();
  return Array.from(engineClozeNumbers(text));
}

/** [text] with its marks removed and every cloze filled. */
export function plainText(text: string): string {
  engine();
  return enginePlainText(text);
}

/** [text] written as markup that reads back as itself: a literal text saved as version 3 (ADR 0208). */
export function escapeLiteral(text: string): string {
  engine();
  return engineEscapeLiteral(text);
}

/** [text] read: its document and its plain text. */
export function markedOf(text: string): Marked {
  engine();
  return { document: parseMarkup(text), plain: enginePlainText(text) };
}

/** Whether [blocks] hold anything a plain text would not show: a mark, a list, a line break or a cloze. */
export function hasFormatting(blocks: Block[]): boolean {
  return (
    blocks.length > 1 ||
    blocks.some(
      (block) => block.type === "list" || block.content.some((run) => run.type !== "text"),
    )
  );
}

// The browser starts loading as soon as a page imports this file, so the module is ready by the
// time a card is edited; a microtask later, so a module installed at once is not fetched again.
if (typeof window !== "undefined") {
  queueMicrotask(() => {
    if (!ready) loadMarkupEngine().catch(() => undefined);
  });
}

/**
 * [blocks] as the engine's `plainText` writes a text (ADR 0208): marks left out, each block, list
 * item and line break a newline apart, and no marker for an item. [cloze] says what each cloze span
 * is, given its answer as plain text and its hint, null for none; the answer where it is not given,
 * which is the engine's `plainText`.
 */
export function documentText(
  blocks: Block[],
  cloze: (answer: string, hint: string | null) => string = (answer) => answer,
): string {
  const runs = (content: Inline[]): string =>
    content
      .map((run) => {
        switch (run.type) {
          case "text":
          case "code":
            return run.text;
          case "lineBreak":
            return "\n";
          case "bold":
          case "italic":
            return runs(run.content);
          case "cloze":
            return cloze(runs(run.answer), run.hint);
          case "blank":
            return "___";
        }
      })
      .join("");
  return blocks
    .flatMap((block) =>
      block.type === "paragraph"
        ? [runs(block.content)]
        : block.items.flatMap((item) => [
            runs(item.content),
            ...item.sublists.flatMap((sub) => sub.items.map(runs)),
          ]),
    )
    .join("\n");
}
