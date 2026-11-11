// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { type Block, holdsBack } from "../authoring";
import { frameProblem, parseCells } from "../card-content";
import { parseCandidates } from "../photo-candidates";
import { cardsOf, defaultForm, formFor, sectionsOf } from "../section-form";
import { cardsOfRows, type Columns } from "../spreadsheet-cards";
import { textContent } from "@/testing/content";
import { inCurrentForms } from "@/testing/frame-fixtures";

/** The cases the app's two `import_frame_test.dart` read, so both save equal 칸 (ADR 0137). */
const root = path.join(import.meta.dirname, "../../../../..");
const fixture = inCurrentForms(
  JSON.parse(readFileSync(path.join(root, "supabase/fixtures/card-frame/import.json"), "utf8")),
) as {
  photo: { name: string; cards: unknown[]; form?: unknown; saved: unknown }[];
  sheet: { name: string; rows: string[][]; columns: Columns; saved: unknown }[];
  held: { name: string; stored: string; back: string; held: boolean }[];
};

/** [blocks] as stored, without the ids a save draws. */
const stored = (blocks: Block[]) => blocks.map(({ type, v, payload }) => ({ type, v, payload }));

describe("the shared import cases", () => {
  it.each(fixture.photo)("photo: $name", ({ cards, form, saved }) => {
    const candidates = parseCandidates({ cards });
    if (!candidates) throw new Error("a fixture's cards did not parse");
    const drafts = sectionsOf("photo", candidates).flatMap((section) =>
      section.cards.flatMap((card) =>
        cardsOf(card, formFor(section, form) ?? defaultForm(section.kind, section.identify)),
      ),
    );
    expect(drafts.map(({ blocks }) => stored(blocks))).toEqual(saved);
    for (const { blocks } of drafts) expect(frameProblem(parseCells(blocks) ?? [])).toBeNull();
  });
  it.each(fixture.sheet)("sheet: $name", ({ rows, columns, saved }) => {
    const sheet = rows.map((cells, at) => ({
      number: at + 1,
      cells: cells.map((text) => ({ text, isText: true })),
    }));
    const { cards } = cardsOfRows(sheet, columns, false, String);
    expect(cards.map(({ blocks }) => stored(blocks))).toEqual(saved);
  });
  it.each(fixture.held)("held: $name", ({ stored, back, held }) => {
    expect(holdsBack([textContent(stored)], back)).toBe(held);
  });
});
