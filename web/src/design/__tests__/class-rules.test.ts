// @vitest-environment node
import { Linter } from "eslint";
import { describe, expect, it } from "vitest";

import { sharedRules, tokenRules } from "../class-rules";

/** The messages ESLint gives [code] under [rules], as `web/eslint.config.mjs` applies them. */
function refusals(code: string, rules: typeof tokenRules): string[] {
  return new Linter({ configType: "flat" })
    .verify(
      code,
      [
        {
          files: ["**/*.jsx"],
          languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
          rules: { "no-restricted-syntax": ["error", ...rules] },
        },
      ],
      "planted.jsx",
    )
    .map((message) => message.message);
}

/** A class on an element, and the same in a template's text. */
const planted = (classes: string) => [
  `const a = <p className="flex ${classes} px-4" />;`,
  "const b = `flex ${x} " + classes + " px-4`;",
];

describe("the design's class rules", () => {
  it.each([
    ["Tailwind's palette", "bg-red-500", "bg-surface"],
    ["a variant on Tailwind's palette", "hover:text-white", "hover:text-ink"],
    ["a colour written out", "bg-[#ff00aa]", "bg-(--color-surface)"],
    ["Tailwind's type scale", "text-2xl", "text-title"],
    ["a type size written out", "text-[15px]", "text-caption"],
    ["Tailwind's radius at a token's value", "rounded-3xl", "rounded-button"],
    ["a side's radius at a token's value", "rounded-t-4xl", "rounded-t-sheet"],
    ["a radius written out", "rounded-[24px]", "rounded-sm"],
    ["a spacing written out", "px-[20px]", "px-gutter"],
    ["a size written out", "min-h-[64px]", "min-h-cta"],
  ])("refuses %s (%s) and passes its token (%s)", (_, literal, token) => {
    for (const code of planted(literal)) expect(refusals(code, tokenRules)).toHaveLength(1);
    for (const code of planted(token)) expect(refusals(code, tokenRules)).toEqual([]);
  });

  it.each([
    ["a button's type", "rounded-button bg-primary text-button", "rounded-button bg-surface"],
    ["the red fill", "rounded-button bg-dont-know-text", "text-dont-know-text"],
    ["a chip", "rounded-chip border px-3 py-1 text-section", "rounded-chip bg-surface"],
  ])("refuses %s drawn by hand outside src/design/ and passes the rest", (_, copy, other) => {
    for (const code of planted(copy)) expect(refusals(code, sharedRules)).toHaveLength(1);
    for (const code of planted(other)) expect(refusals(code, sharedRules)).toEqual([]);
  });

  it("refuses a search field drawn by hand, and passes another input", () => {
    expect(refusals('const a = <input type="search" />;', sharedRules)).toHaveLength(1);
    expect(refusals('const a = <input type="text" />;', sharedRules)).toEqual([]);
  });

  it("refuses a modal drawn by hand, and passes another dialog", () => {
    expect(
      refusals('const a = <div role="dialog" aria-modal="true" />;', sharedRules),
    ).toHaveLength(1);
    expect(refusals('const a = <div role="dialog" aria-label="안내" />;', sharedRules)).toEqual(
      [],
    );
  });

  it("refuses a section's label drawn by hand, and passes a heading in another place", () => {
    const section = (heading: string) =>
      `const a = <section aria-labelledby="s">${heading}<div /></section>;`;
    expect(
      refusals(
        section('<h2 id="s" className="px-1 text-section text-muted">계정</h2>'),
        sharedRules,
      ),
    ).toHaveLength(1);
    expect(
      refusals(section('<h2 id="s" className="text-headline">계정</h2>'), sharedRules),
    ).toEqual([]);
    expect(
      refusals(
        'const a = <nav><h2 className="text-section text-muted">목차</h2></nav>;',
        sharedRules,
      ),
    ).toEqual([]);
  });
});
