import { readFileSync } from "node:fs";
import path from "node:path";

import type { Block } from "@/design/markup-engine";

const directory = path.join(import.meta.dirname, "../../../engine/tests/fixtures/markup");

/** One conformance fixture file of `engine/tests/fixtures/markup/`, read from the repository. */
function fixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(directory, `${name}.json`), "utf8"));
}

/** The fixtures every reader of the markup is held to (`engine.md` §Card text markup). */
export const markupFixtures = {
  parse: fixture("parse") as { name: string; input: string; document: Block[] }[],
  cloze: fixture("cloze") as {
    name: string;
    input: string;
    numbers: number[];
    hidden: Record<string, Block[]>;
    filled: Block[];
  }[],
  plain: fixture("plain") as { name: string; input: string; plainText: string }[],
  escape: fixture("escape") as { name: string; text: string; escaped: string }[],
};
