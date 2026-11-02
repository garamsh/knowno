import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { cardRow, deckRow, uuidOf } from "@/testing/library";
import { otherUser } from "@/testing/mocks/handlers";
import { FakePostgrest } from "@/testing/mocks/postgrest";
import { server } from "@/testing/mocks/server";
import { setRequestCookies } from "@/testing/next-headers";
import { signedInCookies } from "@/testing/session";

import {
  builtCells,
  cellDraft,
  type CellDraft,
  emptyCell,
  emptySense,
  encodeCells,
  frameKey,
  movedSpans,
  parseCellsDraft,
  type WrittenCell,
  withBlankToggled,
  withCellText,
  withoutColumn,
  withoutRow,
  withSpan,
} from "../authoring";
import { parseCardContent, parseCells } from "../card-content";
import { addCard, editCard } from "../save-cards";

vi.mock("next/headers", () => import("@/testing/next-headers"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const conversions = (
  JSON.parse(
    readFileSync(
      path.join(import.meta.dirname, "../../../../../supabase/fixtures/card-frame/conversion.json"),
      "utf8",
    ),
  ) as { name: string; front: unknown; back: unknown; cells: unknown }[]
).filter(({ cells }) => cells !== null);

let db: FakePostgrest;
beforeEach(async () => {
  db = new FakePostgrest();
  server.use(...db.handlers);
  setRequestCookies(await signedInCookies());
  db.rows.decks.push(deckRow("deck", "Deck"));
});

/** [value] with every id left out: a 칸 of no stored id takes a new one when it is written. */
const withoutIds = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value, (key, field: unknown) => (key === "id" ? undefined : field)));

const written = (cells: unknown): WrittenCell[] => {
  const read = parseCells(cells);
  if (!read) throw new Error("a fixture's 칸 did not parse");
  return read.filter((cell): cell is WrittenCell => cell.kind !== "unknown");
};

const glue = (front: string, back: string, id = "b1") => ({
  type: "text",
  v: 2,
  id,
  payload: { front, back },
});
const draftOf = (id: string, ...blocks: unknown[]) => ({ id: uuidOf(id), blocks });
const stored = (id: string, fields: object = {}) => ({
  ...cardRow(id, "deck", "old"),
  template: "free",
  template_version: 1,
  ...fields,
});
const photoBlock = (media: string, side: "front" | "back" = "back") => ({
  type: "image",
  v: 2,
  id: "p1",
  payload: { media, width: 9, height: 9, boxes: [], side },
});

describe("encodeCells", () => {
  it("writes each type in the phone's stored shape, at the frame's version of its type", () => {
    const cells = written([
      glue("a", "b"),
      {
        type: "senses",
        v: 2,
        id: "s",
        payload: {
          term: "apple",
          ask: "meaning",
          senses: [
            {
              labels: [{ kind: "part_of_speech", category: "noun", text: "명" }],
              meaning: "사과",
              examples: ["an apple"],
            },
          ],
        },
      },
      { type: "cloze", v: 1, id: "c", payload: { text: "___", answers: ["x"] } },
      {
        type: "table",
        v: 2,
        id: "t",
        payload: {
          columns: ["a"],
          rows: [["b"]],
          blanks: [{ row: 0, column: 0 }],
          spans: [],
        },
      },
      {
        type: "image",
        v: 2,
        id: "i",
        payload: {
          media: "m",
          width: 3,
          height: 4,
          future: 1,
          boxes: [{ id: "1", x: 0, y: 0, w: 1, h: 1, later: 2 }],
        },
      },
      { type: "audio", v: 2, id: "a", payload: { media: "n", duration_ms: 7, side: "back" } },
    ]);
    expect(encodeCells(cells)).toEqual([
      glue("a", "b"),
      {
        type: "senses",
        v: 2,
        id: "s",
        payload: {
          term: "apple",
          ask: "meaning",
          senses: [
            {
              labels: [{ kind: "part_of_speech", category: "noun", text: "명" }],
              meaning: "사과",
              examples: ["an apple"],
            },
          ],
        },
      },
      { type: "cloze", v: 1, id: "c", payload: { text: "___", answers: ["x"] } },
      {
        type: "table",
        v: 2,
        id: "t",
        payload: { columns: ["a"], rows: [["b"]], blanks: [{ row: 0, column: 0 }], spans: [] },
      },
      {
        type: "image",
        v: 2,
        id: "i",
        payload: {
          media: "m",
          width: 3,
          height: 4,
          future: 1,
          boxes: [{ id: "1", x: 0, y: 0, w: 1, h: 1, later: 2 }],
        },
      },
      { type: "audio", v: 2, id: "a", payload: { media: "n", duration_ms: 7, side: "back" } },
    ]);
  });

  it("gives a 칸 of no id one, and keeps one it holds", () => {
    const blocks = encodeCells(
      [
        { kind: "text", front: "a", back: "" },
        { kind: "text", front: "b", back: "", id: "kept" },
      ],
      () => "made",
    );
    expect(blocks.map(({ id }) => id)).toEqual(["made", "kept"]);
  });

  it.each(conversions)("round-trips through parseCells: $name", ({ cells }) => {
    const read = written(cells);
    expect(withoutIds(parseCells(encodeCells(read)))).toEqual(withoutIds(read));
    expect(withoutIds(parseCells(encodeCells(read)))).not.toEqual([]);
  });
});

describe("a v1 card of each fixture placement", () => {
  it.each(conversions)(
    "opens, saves and reads back whole: $name",
    async ({ front, back, cells }) => {
      const row = stored("card", { front, back, source: "import" });
      db.rows.cards.push(row);
      const read = parseCardContent({ front, back, template: "free", templateVersion: 1 });
      if (!read || read.readOnly) throw new Error("a fixture did not open");
      const built = builtCells(read.cells.map((cell) => cellDraft(cell as WrittenCell)));
      // What the frame refuses the phone refuses too: nothing is written over it.
      if (!built.cells) {
        expect(built.message).not.toBeNull();
        return;
      }
      const blocks = encodeCells(built.cells);
      expect(
        await editCard(uuidOf("deck"), uuidOf("card"), { id: uuidOf("card"), blocks }),
      ).toEqual({
        saved: true,
      });
      const saved = db.rows.cards[0];
      expect(saved).toMatchObject({
        id: uuidOf("card"),
        template: "free",
        template_version: 2,
        back: [],
        source: "import",
        created_at: row.created_at,
      });
      const back2 = parseCardContent({
        front: saved?.front,
        back: saved?.back,
        template: saved?.template,
        templateVersion: saved?.template_version,
      });
      expect(withoutIds(back2?.cells)).toEqual(withoutIds(written(cells)));
      // The same parts show before and after the reveal.
      expect(back2?.front.map(({ kind }) => kind)).toEqual(read.front.map(({ kind }) => kind));
      expect(back2?.back.map(({ kind }) => kind)).toEqual(read.back.map(({ kind }) => kind));
    },
  );

  it("covers the fixtures that can be saved", () => {
    const saved = conversions.filter(({ front, back }) => {
      const read = parseCardContent({ front, back, template: "free", templateVersion: 1 });
      return builtCells((read?.cells ?? []).map((cell) => cellDraft(cell as WrittenCell))).cells;
    });
    for (const placement of [1, 2, 3, 4, 5, 6, 7])
      expect(saved.some(({ name }) => name.includes(`placement ${String(placement)}`))).toBe(true);
  });
});

describe("parseCellsDraft", () => {
  it("refuses what the frame refuses and an unknown 칸, beside a card it accepts", () => {
    const chart = { type: "chart", v: 1, id: "c", payload: {} };
    expect(parseCellsDraft({ id: "a", blocks: [glue("a", "")] })).toBeNull();
    expect(parseCellsDraft({ id: "a", blocks: [glue("a", "b"), chart] })).toBeNull();
    expect(parseCellsDraft({ id: "a", blocks: [] })).toBeNull();
    expect(parseCellsDraft({ id: "a", blocks: [glue("a", "b")] })).toEqual({
      id: "a",
      front: [glue("a", "b")],
      back: [],
    });
  });
});

describe("addCard", () => {
  it("writes free v2, its 칸 in front and an empty back, keyed by what shows first", async () => {
    const card = draftOf("new", glue(" Apple ", "사과"));
    expect(await addCard(uuidOf("deck"), card)).toEqual({ saved: true });
    expect(await addCard(uuidOf("deck"), card)).toEqual({ saved: true });
    expect(db.rows.cards).toHaveLength(1);
    expect(db.rows.cards[0]).toMatchObject({
      front: card.blocks,
      back: [],
      card_key: "apple",
      source: "manual",
      template: "free",
      template_version: 2,
    });
  });

  it("refuses by the shared validity with the phone's words, beside a card it accepts", async () => {
    expect(await addCard(uuidOf("deck"), draftOf("a", glue("", "b")))).toEqual({
      saved: false,
      message: "앞면에 보일 내용을 하나 이상 넣어 주세요",
    });
    expect(await addCard(uuidOf("deck"), draftOf("b", glue("a", "")))).toEqual({
      saved: false,
      message: "뒷면이나 빈칸을 하나 이상 넣어 주세요",
    });
    expect(db.rows.cards).toHaveLength(0);
    // Control: both parts, then a blank alone, which counts for both.
    expect(await addCard(uuidOf("deck"), draftOf("c", glue("a", "b")))).toEqual({ saved: true });
    const cloze = { type: "cloze", v: 1, id: "c", payload: { text: "___", answers: ["x"] } };
    expect(await addCard(uuidOf("deck"), draftOf("d", cloze))).toEqual({ saved: true });
  });

  it("warns on a card the deck holds, and adds it when told to", async () => {
    await addCard(uuidOf("deck"), draftOf("first", glue("Apple", "a")));
    const second = draftOf("second", glue("apple", "b"));
    expect(await addCard(uuidOf("deck"), second)).toMatchObject({
      saved: false,
      duplicate: uuidOf("first"),
    });
    expect(await addCard(uuidOf("deck"), second, true)).toEqual({ saved: true });
    expect(db.rows.cards).toHaveLength(2);
  });

  it("refuses a photo on a new card, since the web uploads none, beside a card without one", async () => {
    const cards = draftOf("photo", glue("a", "b"), photoBlock("m"));
    expect(await addCard(uuidOf("deck"), cards)).toMatchObject({ saved: false });
    expect(db.rows.cards).toHaveLength(0);
    expect(await addCard(uuidOf("deck"), draftOf("plain", glue("a", "b")))).toEqual({
      saved: true,
    });
  });
});

describe("editCard", () => {
  const edit = (id: string, input: unknown, allow?: boolean) =>
    editCard(uuidOf("deck"), uuidOf(id), input, allow);

  it("keeps the card's id, source and creation, leaves its reviews, and takes the new key", async () => {
    db.rows.cards.push(stored("card", { source: "copy", front: [], back: [] }));
    const review = { id: uuidOf("review"), card_id: uuidOf("card"), user_id: "u", rating: "good" };
    db.seed("reviews", review);
    const reviews = JSON.stringify(db.rows.reviews);
    expect(await edit("card", draftOf("card", glue("New", "뒤")))).toEqual({ saved: true });
    expect(db.rows.cards).toHaveLength(1);
    expect(db.rows.cards[0]).toMatchObject({
      id: uuidOf("card"),
      source: "copy",
      card_key: "new",
      template_version: 2,
    });
    expect(db.rows.cards[0]?.updated_at).not.toBe(stored("card").updated_at);
    expect(JSON.stringify(db.rows.reviews)).toBe(reviews);
  });

  it("leaves a later edit made elsewhere, as the later updated_at wins, against an earlier one", async () => {
    const later = new Date(Date.now() + 60_000).toISOString();
    db.rows.cards.push(stored("card", { updated_at: later }));
    expect(await edit("card", draftOf("card", glue("New", "뒤")))).toEqual({
      saved: false,
      message: "다른 곳에서 더 나중에 고친 카드예요. 노트를 다시 열어 주세요.",
    });
    expect(db.rows.cards[0]).toMatchObject({ card_key: "old", updated_at: later });
    // Control: the same edit over an earlier time is written.
    const row = db.rows.cards[0];
    if (row) row.updated_at = new Date(Date.now() - 60_000).toISOString();
    expect(await edit("card", draftOf("card", glue("New", "뒤")))).toEqual({ saved: true });
  });

  it("refuses a deleted card, another deck's and another user's, beside a live one", async () => {
    db.rows.cards.push(
      stored("gone", { deleted_at: new Date(0).toISOString() }),
      stored("foreign", { user_id: otherUser.id }),
      { ...stored("other"), deck_id: uuidOf("elsewhere") },
      stored("live"),
    );
    for (const id of ["gone", "foreign", "other"])
      expect(await edit(id, draftOf(id, glue("New", "뒤")))).toEqual({
        saved: false,
        message: "카드를 찾을 수 없어요. 노트를 다시 열어 주세요.",
      });
    expect(db.rows.cards.filter(({ card_key }) => card_key === "new")).toHaveLength(0);
    expect(await edit("live", draftOf("live", glue("New", "뒤")))).toEqual({ saved: true });
  });

  it("refuses a card of a later template and one holding an unknown block in the phone's words", async () => {
    const chart = { type: "chart", payload: {} };
    const later = stored("later", { template: "free", template_version: 3 });
    const holding = stored("holding", { back: [chart] });
    const framed = stored("framed", {
      template_version: 2,
      front: [glue("a", "b"), chart],
      back: [],
    });
    db.rows.cards.push(later, holding, framed, stored("known"));
    const words =
      "새 버전의 앱에서 만든 카드라 이 버전에서는 편집할 수 없어요. 앱을 업데이트해 주세요.";
    for (const id of ["later", "holding", "framed"]) {
      expect(await edit(id, draftOf(id, glue("New", "뒤")))).toEqual({
        saved: false,
        message: words,
      });
    }
    expect(db.rows.cards[0]).toEqual(later);
    expect(await edit("known", draftOf("known", glue("New", "뒤")))).toEqual({ saved: true });
  });

  it("warns on another card's key, not on its own, and writes it when told to", async () => {
    db.rows.cards.push(stored("mine"), { ...stored("taken"), card_key: "new" });
    const card = draftOf("mine", glue("New", "뒤"));
    expect(await edit("mine", card)).toMatchObject({ saved: false, duplicate: uuidOf("taken") });
    expect(await edit("mine", card, true)).toEqual({ saved: true });
    // Control: saving again finds only itself and the card allowed beside it.
    db.rows.cards.pop();
    expect(await edit("mine", card)).toEqual({ saved: true });
  });

  it("keeps a held photo and refuses one the card does not hold", async () => {
    db.rows.cards.push(
      stored("card", {
        template_version: 2,
        front: [glue("a", "b"), photoBlock("held", "front")],
        back: [],
      }),
    );
    expect(await edit("card", draftOf("card", glue("a", "b"), photoBlock("taken")))).toMatchObject({
      saved: false,
      message: "카드 내용을 확인해 주세요",
    });
    expect(await edit("card", draftOf("card", glue("a", "b"), photoBlock("held")))).toEqual({
      saved: true,
    });
    expect(parseCells(db.rows.cards[0]?.front)?.[1]).toMatchObject({
      kind: "placed",
      side: "back",
    });
  });

  it("refuses a card of a deleted deck, beside one of a live deck", async () => {
    db.rows.decks.push(deckRow("gone", "Gone", true));
    db.rows.cards.push({ ...stored("card"), deck_id: uuidOf("gone") }, stored("live"));
    expect(await editCard(uuidOf("gone"), uuidOf("card"), draftOf("card", glue("a", "b")))).toEqual(
      {
        saved: false,
        message: "노트를 찾을 수 없어요. 추가할 노트를 다시 골라 주세요.",
      },
    );
    expect(await edit("live", draftOf("live", glue("a", "b")))).toEqual({ saved: true });
  });

  it("refuses a draft naming another card, beside its own", async () => {
    db.rows.cards.push(stored("card"));
    expect(await edit("card", draftOf("other", glue("a", "b")))).toMatchObject({ saved: false });
    expect(await edit("card", draftOf("card", glue("a", "b")))).toEqual({ saved: true });
  });

  it("refuses signed out, and fails when the server did not keep what it wrote", async () => {
    db.rows.cards.push(stored("card"));
    setRequestCookies([]);
    expect(await edit("card", draftOf("card", glue("a", "b")))).toEqual({
      saved: false,
      message: "다시 로그인해 주세요",
    });
    setRequestCookies(await signedInCookies());
    const release = db.fail("cards", 400);
    expect(await edit("card", draftOf("card", glue("a", "b")))).toMatchObject({ saved: false });
    release();
    expect(await edit("card", draftOf("card", glue("a", "b")))).toEqual({ saved: true });
  });
});

describe("the editor's drafts", () => {
  const cloze = (line: string, blanks: { start: number; end: number }[]): CellDraft => ({
    ...emptyCell("cloze"),
    kind: "cloze",
    line,
    blanks,
  });
  const onlyMessage = (draft: CellDraft) => builtCells([draft]);

  it("does not save a 글 left empty, which keeps nothing from saving", () => {
    const empty = emptyCell("text");
    const full: CellDraft = { ...emptyCell("text"), kind: "text", front: "a", back: "b" };
    expect(builtCells([empty, full]).cells).toHaveLength(1);
    // Control: alone, the card has nothing to show.
    expect(builtCells([empty])).toEqual({
      cells: null,
      message: "앞면에 보일 내용을 하나 이상 넣어 주세요",
    });
  });

  it("opens a stored cloze with its blanks in place and saves it unchanged", () => {
    const block = { kind: "cloze" as const, text: "___ is ___.", answers: ["Rose", "red"] };
    const draft = cellDraft({ kind: "blank", block: { ...block, id: "c" } });
    expect(draft).toMatchObject({
      line: "Rose is red.",
      blanks: [
        { start: 0, end: 4 },
        { start: 8, end: 11 },
      ],
    });
    expect(builtCells([draft]).cells).toEqual([{ kind: "blank", block: { ...block, id: "c" } }]);
  });

  it("asks for a blank, and refuses underscores that read as one, against a line that saves", () => {
    expect(onlyMessage(cloze("no blank", [])).cells).toBeNull();
    expect(onlyMessage(cloze("a ___ b", [{ start: 0, end: 1 }])).cells).toBeNull();
    expect(onlyMessage(cloze("a b", [{ start: 0, end: 1 }])).cells).not.toBeNull();
  });

  it("drops a blank of whitespace rather than storing an empty answer", () => {
    expect(onlyMessage(cloze("a b", [{ start: 1, end: 2 }])).cells).toBeNull();
  });

  it("keeps a label as stored until its field changes", () => {
    const labels = [{ kind: "part_of_speech", category: "noun", text: "noun" }] as const;
    const stored = cellDraft({
      kind: "word",
      term: "a",
      ask: "term",
      senses: [{ labels: [...labels], meaning: "b", examples: [] }],
      id: "w",
    });
    expect(builtCells([stored]).cells?.[0]).toMatchObject({ senses: [{ labels }] });
    if (stored.kind !== "word") throw new Error("a word opens as a word");
    const [sense] = stored.senses;
    if (!sense) throw new Error("a word has a sense");
    expect(
      builtCells([{ ...stored, senses: [{ ...sense, label: "동 x" }] }]).cells?.[0],
    ).toMatchObject({
      senses: [
        {
          labels: [
            { kind: "part_of_speech", category: "verb", text: "동" },
            { kind: "other", category: null, text: "x" },
          ],
        },
      ],
    });
  });

  it("trims a meaning and its example lines", () => {
    const word = emptyCell("word");
    if (word.kind !== "word") throw new Error("a word opens as a word");
    const senses = [{ ...emptySense(), meaning: " b ", examples: " x \n\n y" }];
    expect(builtCells([{ ...word, term: " a ", senses }]).cells?.[0]).toMatchObject({
      term: "a",
      senses: [{ meaning: "b", examples: ["x", "y"] }],
    });
  });

  it("states the phone's messages for a meaning, a table and its blank", () => {
    const table = emptyCell("table");
    if (table.kind !== "table") throw new Error("a table opens as a table");
    expect(builtCells([table]).cells).toBeNull();
    const toggled = withBlankToggled(table, 0, 0, { start: 0, end: 0 });
    expect(toggled.blanks).toEqual([{ row: 0, column: 0 }]);
    expect(builtCells([toggled]).cells).toBeNull();
    const filled = withCellText(toggled, 0, 0, "x");
    expect(builtCells([filled]).cells).not.toBeNull();
  });
});

describe("spans through an edit", () => {
  const blank = { start: 2, end: 5 };

  it("moves a span after the change and keeps one before it, and drops one it touches", () => {
    expect(movedSpans("a Rose b", "xa Rose b", [blank])).toEqual([{ start: 3, end: 6 }]);
    expect(movedSpans("a Ros", "a Ros!", [blank])).toEqual([blank]);
    expect(movedSpans("a Rose b", "a Rise b", [{ start: 2, end: 6 }])).toEqual([]);
  });

  it("grows only the open blank with what is typed in it", () => {
    expect(movedSpans("ab", "aXb", [{ start: 1, end: 1 }], 1)).toEqual([{ start: 1, end: 2 }]);
    expect(movedSpans("aXb", "aXYb", [{ start: 1, end: 2 }], 1)).toEqual([{ start: 1, end: 3 }]);
    // Control: closed, the same blank is left as it was.
    expect(movedSpans("aXb", "aXYb", [{ start: 1, end: 2 }])).toEqual([{ start: 1, end: 2 }]);
  });

  it("replaces the spans a new one overlaps", () => {
    expect(
      withSpan(
        [
          { start: 0, end: 2 },
          { start: 5, end: 7 },
        ],
        { start: 1, end: 3 },
      ),
    ).toEqual([
      { start: 1, end: 3 },
      { start: 5, end: 7 },
    ]);
  });
});

describe("a table draft", () => {
  const base = (): Extract<CellDraft, { kind: "table" }> => ({
    kind: "table",
    id: "t",
    columns: ["a", "b"],
    rows: [
      ["one", " two "],
      ["three", "four"],
    ],
    blanks: [{ row: 1, column: 1 }],
    spans: [{ row: 0, column: 1, start: 1, end: 4 }],
  });

  it("makes a selection a span, dropping the cell's whole blank, and turns it back", () => {
    const spanned = withBlankToggled(base(), 1, 1, { start: 0, end: 2 });
    expect(spanned.blanks).toEqual([]);
    expect(spanned.spans).toContainEqual({ row: 1, column: 1, start: 0, end: 2 });
    expect(withBlankToggled(spanned, 1, 1, { start: 0, end: 2 }).spans).toEqual(base().spans);
    // Control: whitespace alone makes no span.
    expect(withBlankToggled(base(), 0, 1, { start: 0, end: 1 })).toEqual(base());
  });

  it("makes a cell a whole blank, dropping its spans, and a plain cell again", () => {
    const whole = withBlankToggled(base(), 0, 1, { start: 0, end: 0 });
    expect(whole.spans).toEqual([]);
    expect(whole.blanks).toContainEqual({ row: 0, column: 1 });
    expect(withBlankToggled(whole, 0, 1, { start: 0, end: 0 }).blanks).toEqual(base().blanks);
  });

  it("saves a span moved with its cell's trim", () => {
    expect(builtCells([base()]).cells?.[0]).toMatchObject({
      block: {
        rows: [
          ["one", "two"],
          ["three", "four"],
        ],
        spans: [{ row: 0, column: 1, start: 0, end: 3 }],
      },
    });
  });

  it("moves the blanks with their cells and drops those removed", () => {
    const noRow = withoutRow(base(), 0);
    expect(noRow.rows).toEqual([["three", "four"]]);
    expect(noRow.blanks).toEqual([{ row: 0, column: 1 }]);
    expect(noRow.spans).toEqual([]);
    const noColumn = withoutColumn(base(), 0);
    expect(noColumn.columns).toEqual(["b"]);
    expect(noColumn.blanks).toEqual([{ row: 1, column: 0 }]);
    expect(withoutColumn(base(), 1).blanks).toEqual([]);
  });

  it("keeps the spans an edit to their cell leaves whole", () => {
    expect(withCellText(base(), 0, 1, " two x").spans).toEqual(base().spans);
    expect(withCellText(base(), 0, 1, "x two ").spans).toEqual([
      { row: 0, column: 1, start: 2, end: 5 },
    ]);
    expect(withCellText(base(), 0, 1, " tXo ").spans).toEqual([]);
  });
});

describe("frameKey", () => {
  it("reads what shows before the reveal, every blank filled, in 칸 order, and a word's asked side", () => {
    expect(
      frameKey(
        written([
          { type: "cloze", v: 1, payload: { text: "___ is", answers: ["Rose"] } },
          glue("  RED ", "back"),
          {
            type: "senses",
            v: 2,
            payload: {
              term: "word",
              ask: "meaning",
              senses: [{ labels: [], meaning: "뜻", examples: [] }],
            },
          },
        ]),
      ),
    ).toBe("rose is red 뜻");
  });

  it("keys a photo by its media id and box answers", () => {
    expect(
      frameKey(
        written([
          {
            type: "image",
            v: 2,
            payload: {
              media: "M",
              width: 1,
              height: 1,
              boxes: [{ id: "1", x: 0, y: 0, w: 1, h: 1, answer: "A" }],
            },
          },
        ]),
      ),
    ).toBe("m a");
  });
});
