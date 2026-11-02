// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A deck is a 노트 in every string a user reads (ADR 0148). This reads the source of every module
 * under web/src/ but tests and test helpers, and names each line that still says 덱.
 */

const src = path.join(import.meta.dirname, "..");

/**
 * Files that may still say 덱, with the reason. The issue #575 rewrites both with 노트 already,
 * so they stay out of #577's change; the entry goes when #575 merges.
 */
const allowed = new Map([
  ["app/(shell)/account/_components/ai-connection.tsx", "its text is written in #575"],
  ["app/oauth/consent/_components/consent-form.tsx", "its text is written in #575"],
]);

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

/** Where 덱 stands in the modules outside [skip]. */
function deckWording(files: readonly string[], skip: ReadonlyMap<string, string>): string[] {
  return files
    .filter((file) => !skip.has(file))
    .flatMap((file) => found(file, readFileSync(path.join(src, file), "utf8")));
}

describe("the 노트 naming", () => {
  const files = modules();

  it("leaves no 덱 in a module a user's text comes from, but the allowed files", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(deckWording(files, allowed)).toEqual([]);
  });

  it("keeps every allowed file in the tree, so an entry goes when its file does", () => {
    for (const file of allowed.keys()) expect(files).toContain(file);
  });

  it("finds a planted 덱 and passes a 노트, and skips an allowed file only", () => {
    expect(found("a.tsx", '<h1>새 덱</h1>\n<h1>새 노트</h1>\n"덱을 숨겼어요"')).toEqual([
      "a.tsx:1",
      "a.tsx:3",
    ]);
    // Control: the allow-list alone decides whether an allowed file's 덱 is reported.
    expect(
      deckWording(["app/(shell)/account/_components/ai-connection.tsx"], new Map()).length,
    ).toBeGreaterThan(0);
    expect(deckWording(["app/(shell)/account/_components/ai-connection.tsx"], allowed)).toEqual([]);
  });
});
