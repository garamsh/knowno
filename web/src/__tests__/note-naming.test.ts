// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A deck is a 노트 in every string a user reads (ADR 0148). This reads the source of every module
 * under web/src/ but tests and test helpers, and names each line that still says 덱.
 */

const src = path.join(import.meta.dirname, "..");

/** Files that may still say 덱, with the reason. None does. */
const allowed: ReadonlyMap<string, string> = new Map();

const word = /덱/u;

/** Every source module under web/src/ but tests and test helpers, as a path from web/src/. */
function modules(dir = src): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) {
      return name === "__tests__" || name === "testing" ? [] : modules(file);
    }
    return /\.tsx?$/.test(name) ? [path.relative(src, file)] : [];
  });
}

/** The `file:line` of each line of [text] that matches [word], for the file named [name]. */
function found(name: string, text: string): string[] {
  return text
    .split("\n")
    .flatMap((line, index) => (word.test(line) ? [`${name}:${String(index + 1)}`] : []));
}

/** Where 덱 stands in the modules of [root] outside [skip]. */
function deckWording(
  files: readonly string[],
  skip: ReadonlyMap<string, string>,
  root = src,
): string[] {
  return files
    .filter((file) => !skip.has(file))
    .flatMap((file) => found(file, readFileSync(path.join(root, file), "utf8")));
}

describe("the 노트 naming", () => {
  it("leaves no 덱 in a module a user's text comes from", () => {
    const files = modules();
    expect(files.length).toBeGreaterThan(100);
    expect(deckWording(files, allowed)).toEqual([]);
  });

  it("finds a planted 덱 and passes a 노트, and skips an allowed file only", () => {
    expect(found("a.tsx", '<h1>새 덱</h1>\n<h1>새 노트</h1>\n"덱을 숨겼어요"')).toEqual([
      "a.tsx:1",
      "a.tsx:3",
    ]);
    // Control: the allow-list alone decides whether a file's 덱 is reported.
    const root = mkdtempSync(path.join(tmpdir(), "note-naming-"));
    try {
      writeFileSync(path.join(root, "a.tsx"), "<h1>새 덱</h1>\n");
      expect(deckWording(["a.tsx"], new Map(), root)).toEqual(["a.tsx:1"]);
      expect(deckWording(["a.tsx"], new Map([["a.tsx", "planted"]]), root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true });
    }
  });
});
