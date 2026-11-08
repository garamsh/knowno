import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { markupFixtures } from "@/testing/markup-fixtures";

import { type Block, type Inline, parse } from "../markup-engine";
import { MarkupText } from "../markup-text";

/** How many runs of [type] [runs] hold, nested ones included. */
function count(runs: Inline[], type: Inline["type"]): number {
  return runs.reduce(
    (sum, run) =>
      sum +
      (run.type === type ? 1 : 0) +
      (run.type === "bold" || run.type === "italic" ? count(run.content, type) : 0) +
      (run.type === "cloze" ? count(run.answer, type) : 0),
    0,
  );
}

function runsOf(document: Block[]): Inline[][] {
  return document.flatMap((block) =>
    block.type === "paragraph"
      ? [block.content]
      : block.items.flatMap((item) => [item.content, ...item.sublists.flatMap((sub) => sub.items)]),
  );
}

/** The text the lines draw, with each list marker and no newline: a block is a box, not a character. */
function drawn(document: Block[]): string {
  const text = (runs: Inline[]): string =>
    runs
      .map((run) => {
        switch (run.type) {
          case "text":
          case "code":
            return run.text;
          case "lineBreak":
            return "";
          case "bold":
          case "italic":
            return text(run.content);
          case "cloze":
            return text(run.answer);
          case "blank":
            return "___";
        }
      })
      .join("");
  return document
    .flatMap((block) =>
      block.type === "paragraph"
        ? [text(block.content)]
        : block.items.flatMap((item, at) => [
            `${block.ordered ? `${String(at + 1)}. ` : "• "}${text(item.content)}`,
            ...item.sublists.flatMap((sub) =>
              sub.items.map(
                (line, lineAt) =>
                  `  ${sub.ordered ? `${String(lineAt + 1)}. ` : "◦ "}${text(line)}`,
              ),
            ),
          ]),
    )
    .join("");
}

describe("MarkupText over every fixture's document", () => {
  it.each(markupFixtures.parse)(
    "draws $name as a line for each block, item and nested item, and a mark for each mark",
    ({ document }) => {
      const { container } = render(<MarkupText document={document} />);

      // A paragraph is one line and a list item one line, as ADR 0208's model draws them.
      expect(container.querySelectorAll("[data-markup]")).toHaveLength(runsOf(document).length);
      const all = runsOf(document).flat();
      expect(container.querySelectorAll("strong")).toHaveLength(count(all, "bold"));
      expect(container.querySelectorAll("em")).toHaveLength(count(all, "italic"));
      expect(container.querySelectorAll("code")).toHaveLength(count(all, "code"));
      expect(container.querySelectorAll("br")).toHaveLength(count(all, "lineBreak"));
      expect(container.textContent).toBe(drawn(document));
    },
  );

  it("draws an empty paragraph as a line a line high, so a run of blank lines keeps its height", () => {
    const { container } = render(<MarkupText document={parse("a\n\n\nb")} />);

    const lines = [...container.querySelectorAll("[data-markup]")];
    expect(lines.map((line) => line.textContent)).toEqual(["a", "", "", "b"]);
    expect(lines.map((line) => line.className.includes("min-h-[1lh]"))).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it("draws a cloze as its answer, or as what [cloze] gives for it", () => {
    const document = parse("{{c1::Paris::city}} is {{c2::big}}");
    const { container, rerender } = render(<MarkupText document={document} />);
    expect(container).toHaveTextContent("Paris is big");

    rerender(
      <MarkupText
        document={document}
        cloze={(span) => <b data-hint={span.hint ?? "none"}>[{span.number}]</b>}
      />,
    );
    expect(screen.getAllByText(/\[\d\]/u).map((blank) => blank.getAttribute("data-hint"))).toEqual([
      "city",
      "none",
    ]);
  });
});
