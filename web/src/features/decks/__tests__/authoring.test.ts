import { beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { cardRow, deckRow, side, uuidOf } from "@/testing/library";
import { otherUser, supabaseUrl } from "@/testing/mocks/handlers";
import { FakePostgrest } from "@/testing/mocks/postgrest";
import { server } from "@/testing/mocks/server";
import { setRequestCookies } from "@/testing/next-headers";
import { signedInCookies } from "@/testing/session";
import { createDeck } from "../create-deck";
import { saveCards, savePhotoCards } from "../save-cards";
import { block, cardKey, encodeCells } from "../authoring";
import { readAllowance } from "../read-allowance";
import { parseCandidates } from "../photo-candidates";
import { parseCardContent, parseCells, parseContent } from "../card-content";
import { cardsOf, defaultForm } from "../section-form";

vi.mock("next/headers", () => import("@/testing/next-headers"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
let db: FakePostgrest;
beforeEach(async () => {
  db = new FakePostgrest();
  server.use(...db.handlers);
  setRequestCookies(await signedInCookies());
});
const appleSenses = [
  {
    labels: [{ kind: "part_of_speech" as const, category: "noun" as const, text: "명" }],
    meaning: "사과",
    examples: ["an apple"],
  },
];
const draft = (name = " Apple ") => ({
  id: uuidOf("new-card"),
  blocks: encodeCells([{ kind: "word", term: name, senses: appleSenses, ask: "term" }]),
});

describe("web authoring writes", () => {
  it("creates an owner-scoped private deck and a free card once across retries", async () => {
    expect(await createDeck(uuidOf("new"), "단어장")).toEqual({
      saved: true,
      deckId: uuidOf("new"),
    });
    expect(await createDeck(uuidOf("new"), "단어장")).toEqual({
      saved: true,
      deckId: uuidOf("new"),
    });
    const card = draft();
    expect(await saveCards(uuidOf("new"), [card], "manual")).toEqual({ saved: true });
    expect(await saveCards(uuidOf("new"), [card], "manual")).toEqual({ saved: true });
    expect(db.rows.decks).toHaveLength(1);
    expect(db.rows.cards).toHaveLength(1);
    expect(db.rows.cards[0]).toMatchObject({
      deck_id: uuidOf("new"),
      card_key: "apple",
      source: "manual",
      template: "free",
      template_version: 2,
      back: [],
    });
    expect(parseCells(db.rows.cards[0]?.front)).toEqual([
      expect.objectContaining({ kind: "word", term: " Apple ", senses: appleSenses, ask: "term" }),
    ]);
  });
  it("stores an offered note colour with a new deck, and refuses one it does not offer", async () => {
    expect(await createDeck(uuidOf("peach"), "단어장", "violet")).toEqual({
      saved: true,
      deckId: uuidOf("peach"),
    });
    expect(db.rows.decks[0]).toMatchObject({ name: "단어장", color: "violet" });
    // Control: a removed colour and an unknown key write nothing.
    for (const color of ["sky", "constructor"]) {
      expect(await createDeck(uuidOf(color), "단어장", color)).toMatchObject({ saved: false });
    }
    expect(db.rows.decks).toHaveLength(1);
  });
  it("warns on the phone's normalized duplicate without overwriting it, and permits an explicit extra card", async () => {
    db.rows.decks.push(deckRow("deck", "Deck"));
    const first = draft("Ａpple");
    expect(await saveCards(uuidOf("deck"), [first], "manual")).toEqual({ saved: true });
    const second = { ...draft("apple"), id: uuidOf("second") };
    expect(await saveCards(uuidOf("deck"), [second], "manual")).toMatchObject({
      saved: false,
      duplicate: first.id,
    });
    expect(db.rows.cards).toHaveLength(1);
    expect(await saveCards(uuidOf("deck"), [second], "manual", true)).toEqual({ saved: true });
    expect(db.rows.cards).toHaveLength(2);
    expect(db.rows.cards[0]?.front).toEqual(first.blocks);
  });
  it("retains the request for retry after a write failure", async () => {
    db.rows.decks.push(deckRow("deck", "Deck"));
    const card = draft();
    const release = db.fail("cards", 400);
    expect(await saveCards(uuidOf("deck"), [card], "manual")).toMatchObject({ saved: false });
    expect(db.rows.cards).toHaveLength(0);
    release();
    expect(await saveCards(uuidOf("deck"), [card], "manual")).toEqual({ saved: true });
    expect(db.rows.cards).toHaveLength(1);
  });
  it("refuses invalid, foreign and deleted decks and signed-out writes beside an accepted owned deck", async () => {
    db.rows.decks.push(
      deckRow("own", "Own"),
      { ...deckRow("foreign", "Foreign", false, "public"), user_id: otherUser.id },
      deckRow("gone", "Gone", true),
    );
    const card = draft();
    for (const id of ["bad", uuidOf("foreign"), uuidOf("gone")])
      expect(await saveCards(id, [card], "manual")).toMatchObject({ saved: false });
    expect(db.rows.cards).toHaveLength(0);
    expect(await saveCards(uuidOf("own"), [card], "manual")).toEqual({ saved: true });
    setRequestCookies([]);
    expect(await createDeck(uuidOf("no-session"), "No")).toMatchObject({ saved: false });
    expect(
      await saveCards(uuidOf("own"), [{ ...card, id: uuidOf("signed-out") }], "manual"),
    ).toMatchObject({ saved: false });
    expect(db.rows.cards).toHaveLength(1);
  });
  it("refuses malformed content without changing an existing card", async () => {
    db.rows.decks.push(deckRow("own", "Own"));
    const card = draft();
    expect(await saveCards(uuidOf("own"), [card], "manual")).toEqual({ saved: true });
    expect(
      await saveCards(
        uuidOf("own"),
        [{ ...card, blocks: [{ type: "table", v: 2, id: "block", payload: {} }] }],
        "manual",
      ),
    ).toMatchObject({ saved: false });
    expect(db.rows.cards[0]?.front).toEqual(card.blocks);
  });
});

describe("a photo's cards saved over cards the deck holds", () => {
  const incoming = (id: string, front: string, back: string) => ({
    id: uuidOf(id),
    blocks: encodeCells([{ kind: "text", front, back }]),
  });
  const twoMeanings = {
    id: uuidOf("incoming"),
    blocks: encodeCells([
      {
        kind: "word",
        term: "수도",
        senses: [
          { labels: [], meaning: "서울", examples: [] },
          { labels: [], meaning: "도시", examples: [] },
        ],
        ask: "term",
      },
    ]),
  };
  /** What [row]'s 칸 add by the reveal, read as any card is. */
  const added = (row: Record<string, unknown> | undefined) =>
    parseCardContent({
      front: row?.front,
      back: row?.back,
      template: row?.template,
      templateVersion: row?.template_version,
    })?.back.map((part) => (part.kind === "text" ? part.text : part.kind));
  /** The stored row of [id], as `FakePostgrest` holds it. */
  const stored = (id: string) => db.rows.cards.find((row) => row.id === uuidOf(id));
  /** A deck holding the card "held", of front 수도, as [fields] say over a phone's row. */
  function hold(fields: Record<string, unknown> = {}) {
    db.seed("decks", deckRow("deck", "Deck"));
    db.seed("cards", { ...cardRow("held", "deck", "수도"), ...fields });
    const row = stored("held");
    if (!row) throw new Error("expected the seeded card");
    return row;
  }

  it("appends the back as a text block, keeping the card's id, front and key, beside a new card inserted", async () => {
    const before = hold({ template: "free", template_version: 1 });
    const result = await savePhotoCards(uuidOf("deck"), [
      incoming("incoming", "  수도 ", "서울"),
      incoming("other", "인구", "많음"),
    ]);
    expect(result).toEqual({ saved: true });
    expect(db.rows.cards.map((row) => row.id)).toEqual([uuidOf("held"), uuidOf("other")]);
    const after = stored("held");
    expect(after?.back).toEqual([
      ...side("수도 back"),
      expect.objectContaining({ type: "text", v: 1, payload: { text: "서울" } }),
    ]);
    expect(after).toMatchObject({
      front: before.front,
      card_key: "수도",
      source: "manual",
      created_at: before.created_at,
      template: "free",
      template_version: 1,
    });
    expect(after?.updated_at).not.toBe(before.updated_at);
    expect(Number(after?.revision)).toBeGreaterThan(Number(before.revision));
    expect(stored("other")).toMatchObject({
      source: "import",
      template: "free",
      template_version: 2,
      back: [],
    });
  });
  it("writes nothing when a line of the back holds it under the card key normalization, against one that does not", async () => {
    const before = hold({ back: [...side("Ｓeoul"), ...side("서울")] });
    const held = incoming("incoming", "수도", " seoul ");
    expect(await savePhotoCards(uuidOf("deck"), [held])).toEqual({ saved: true });
    expect(stored("held")).toEqual(before);
    expect(db.requests).not.toContain("PATCH cards");
    expect(await savePhotoCards(uuidOf("deck"), [incoming("again", "수도", "부산")])).toEqual({
      saved: true,
    });
    expect(db.rows.cards).toHaveLength(1);
    expect(parseContent(stored("held")?.back)).toHaveLength(3);
  });
  it("adds nothing for an empty back, against a back of text", async () => {
    const before = hold();
    const cloze = {
      id: uuidOf("cloze"),
      blocks: [block("cloze", { text: "___", answers: ["수도"] })],
    };
    expect(await savePhotoCards(uuidOf("deck"), [cloze])).toEqual({ saved: true });
    expect(stored("held")).toEqual(before);
    expect(db.rows.cards).toHaveLength(1);
    const card = incoming("incoming", "수도", "서울");
    expect(await savePhotoCards(uuidOf("deck"), [card])).toEqual({ saved: true });
    expect(parseContent(stored("held")?.back)).toHaveLength(2);
  });
  it("holds a back of several lines that one stored line spells, as the phone's whole-back key does", async () => {
    const before = hold({ back: side("서울 도시") });
    expect(await savePhotoCards(uuidOf("deck"), [twoMeanings])).toEqual({ saved: true });
    expect(stored("held")).toEqual(before);
  });
  it("records free version 1 on a card of no template or an earlier one, and keeps a later build's", async () => {
    hold();
    await savePhotoCards(uuidOf("deck"), [incoming("incoming", "수도", "서울")]);
    expect(stored("held")).toMatchObject({ template: "free", template_version: 1 });
    expect(parseContent(stored("held")?.back)).toHaveLength(2);
    for (const [name, template, version] of [
      ["flip", "flip", 1],
      ["later", "later", 1],
      ["free-3", "free", 3],
    ] as const) {
      db.seed("cards", {
        ...cardRow(name, "deck", name),
        template,
        template_version: version,
      });
      await savePhotoCards(uuidOf("deck"), [incoming(`in-${name}`, name, "서울")]);
      expect(parseContent(stored(name)?.back)).toHaveLength(2);
      expect(stored(name)).toMatchObject({
        template: name === "flip" ? "free" : template,
        template_version: name === "flip" ? 1 : version,
      });
    }
  });
  it("compares against a v1 card's stored back, not the back its 칸 show", async () => {
    const filled = "서울은 한국의 수도";
    const before = hold({
      front: [block("cloze", { text: "서울은 ___의 수도", answers: ["한국"] })],
      back: side(filled),
      template: "free",
      template_version: 1,
      card_key: "서울은 한국의 수도",
    });
    const repeat = {
      id: uuidOf("incoming"),
      blocks: [
        block("cloze", { text: "서울은 ___의 수도", answers: ["한국"] }),
        ...encodeCells([{ kind: "text", front: "", back: filled }]),
      ],
    };
    expect(await savePhotoCards(uuidOf("deck"), [repeat])).toEqual({ saved: true });
    expect(stored("held")).toEqual(before);
  });
  it("appends a 글 of a back alone to a free v2 card's 칸, its v2 and empty back kept, against a back it holds", async () => {
    const before = hold({
      front: [
        { type: "text", v: 2, id: "cell", payload: { front: "수도", back: "서울" } },
        { type: "later", v: 1, id: "kept", payload: { what: "unknown" } },
      ],
      back: [],
      template: "free",
      template_version: 2,
    });
    const held = incoming("incoming", "수도", "서울");
    expect(await savePhotoCards(uuidOf("deck"), [held])).toEqual({ saved: true });
    expect(stored("held")).toEqual(before);
    expect(await savePhotoCards(uuidOf("deck"), [incoming("again", "수도", "부산")])).toEqual({
      saved: true,
    });
    expect(db.rows.cards).toHaveLength(1);
    const after = stored("held");
    expect(after).toMatchObject({ back: [], template: "free", template_version: 2 });
    expect(after?.front).toEqual([
      ...(before.front as unknown[]),
      expect.objectContaining({ type: "text", v: 2, payload: { front: "", back: "부산" } }),
    ]);
    expect(added(after)).toEqual(["서울", "부산"]);
  });
  it("merges a card of an earlier one's key, in one request and across two, into one card", async () => {
    db.seed("decks", deckRow("deck", "Deck"));
    expect(
      await savePhotoCards(uuidOf("deck"), [
        incoming("first", "수도", "서울"),
        incoming("second", "수도", "부산"),
      ]),
    ).toEqual({ saved: true });
    expect(db.rows.cards.map((row) => row.id)).toEqual([uuidOf("first")]);
    expect(await savePhotoCards(uuidOf("deck"), [incoming("third", "수도", "대구")])).toEqual({
      saved: true,
    });
    expect(db.rows.cards.map((row) => row.id)).toEqual([uuidOf("first")]);
    expect(added(stored("first"))).toEqual(["서울", "부산", "대구"]);
    expect(stored("first")).toMatchObject({ source: "import", template_version: 2, back: [] });
  });
  it("merges two cards of one request into one stored card, each after the other", async () => {
    hold();
    expect(
      await savePhotoCards(uuidOf("deck"), [
        incoming("first", "수도", "서울"),
        incoming("second", "수도", "부산"),
      ]),
    ).toEqual({ saved: true });
    expect(db.rows.cards).toHaveLength(1);
    expect(parseContent(stored("held")?.back)).toEqual(
      ["수도 back", "서울", "부산"].map((text) => ({ kind: "text", text })),
    );
  });
  it("merges a back of several lines once across a retry, as one that names each line", async () => {
    hold();
    expect(await savePhotoCards(uuidOf("deck"), [twoMeanings])).toEqual({ saved: true });
    expect(parseContent(stored("held")?.back)).toEqual([
      { kind: "text", text: "수도 back" },
      { kind: "text", text: "서울\n도시" },
    ]);
    const merged = stored("held");
    expect(await savePhotoCards(uuidOf("deck"), [twoMeanings])).toEqual({ saved: true });
    expect(stored("held")).toEqual(merged);
  });
  it("leaves a retried card as stored once a later request merged into it, against a new card beside it", async () => {
    db.seed("decks", deckRow("deck", "Deck"));
    const first = incoming("first", "수도", "서울");
    await savePhotoCards(uuidOf("deck"), [first]);
    await savePhotoCards(uuidOf("deck"), [incoming("second", "수도", "부산")]);
    const merged = stored("first");
    expect(added(merged)).toHaveLength(2);
    expect(await savePhotoCards(uuidOf("deck"), [first, incoming("new", "인구", "많음")])).toEqual({
      saved: true,
    });
    expect(stored("first")).toEqual(merged);
    expect(db.rows.cards).toHaveLength(2);
  });
  it("merges only into a live card of the deck, inserting beside a deleted one and another deck's", async () => {
    db.seed("decks", deckRow("deck", "Deck"), deckRow("other", "Other"));
    db.seed(
      "cards",
      { ...cardRow("gone", "deck", "수도"), deleted_at: "2026-01-01T00:00:00.000Z" },
      cardRow("elsewhere", "other", "수도"),
    );
    expect(await savePhotoCards(uuidOf("deck"), [incoming("incoming", "수도", "서울")])).toEqual({
      saved: true,
    });
    expect(db.rows.cards).toHaveLength(3);
    expect(parseContent(stored("gone")?.back)).toHaveLength(1);
    expect(parseContent(stored("elsewhere")?.back)).toHaveLength(1);
  });
  it("saves nothing when a card to merge into cannot be read, as the phone refuses it, against a readable one", async () => {
    const before = hold({ back: [{ type: "text", payload: {} }] });
    const cards = [incoming("incoming", "수도", "서울"), incoming("other", "인구", "많음")];
    expect(await savePhotoCards(uuidOf("deck"), cards)).toMatchObject({ saved: false });
    expect(db.rows.cards).toEqual([before]);
    before.back = side("수도 back");
    expect(await savePhotoCards(uuidOf("deck"), cards)).toEqual({ saved: true });
    expect(db.rows.cards).toHaveLength(2);
  });
  it("fails a merge the server did not keep, and merges once on the retry", async () => {
    hold();
    const card = incoming("incoming", "수도", "서울");
    server.use(
      http.patch(`${supabaseUrl}/rest/v1/cards`, () => new HttpResponse(null, { status: 204 }), {
        once: true,
      }),
    );
    expect(await savePhotoCards(uuidOf("deck"), [card])).toMatchObject({ saved: false });
    expect(parseContent(stored("held")?.back)).toHaveLength(1);
    expect(await savePhotoCards(uuidOf("deck"), [card])).toEqual({ saved: true });
    expect(parseContent(stored("held")?.back)).toHaveLength(2);
  });
  it("leaves saveCards refusing the same duplicate, unchanged", async () => {
    const before = hold();
    expect(
      await saveCards(uuidOf("deck"), [incoming("incoming", "수도", "서울")], "import"),
    ).toMatchObject({ saved: false, duplicate: uuidOf("held") });
    expect(db.rows.cards).toEqual([before]);
  });
  it("refuses malformed input and a deck the user does not hold before it merges", async () => {
    const before = hold();
    expect(await savePhotoCards("bad", [incoming("incoming", "수도", "서울")])).toMatchObject({
      saved: false,
    });
    expect(await savePhotoCards(uuidOf("deck"), [])).toMatchObject({ saved: false });
    expect(db.rows.cards).toEqual([before]);
    expect(await savePhotoCards(uuidOf("deck"), [incoming("incoming", "수도", "서울")])).toEqual({
      saved: true,
    });
  });
});

describe("photo candidates and allowance", () => {
  it("merges a photo's later back on a line of its text unless a line holds it", () => {
    const note = { kind: "note", type: "concept", front: "수도", topic: "도시" };
    const cards = parseCandidates({
      cards: [
        { ...note, answer: "서울" },
        { ...note, answer: "서울특별시" },
        { ...note, answer: "서울" },
      ],
    });
    expect(cards).toHaveLength(1);
    expect(parseContent(cards?.[0]?.back)).toEqual([{ kind: "text", text: "서울\n서울특별시" }]);
  });
  it("maps vocabulary senses and examples and whole cloze/table cards into existing content readers, saving only reviewed cards", async () => {
    const cards = parseCandidates({
      cards: [
        {
          kind: "vocabulary",
          type: "concept",
          front: "apple",
          topic: "과일",
          answer: "사과",
          senses: [{ labels: [], meaning: "사과", examples: ["an apple"] }],
        },
        {
          kind: "note",
          type: "cloze",
          front: "서울은 ___",
          topic: "도시",
          cloze: { answers: ["수도"] },
        },
        {
          kind: "note",
          type: "table",
          front: "도시",
          topic: "도시",
          table: {
            columns: ["도시", "나라"],
            rows: [["서울", "한국"]],
            blanks: [{ row: 0, column: 1 }],
          },
        },
      ],
    });
    expect(cards).not.toBeNull();
    expect(db.rows.cards).toHaveLength(0);
    db.rows.decks.push(deckRow("own", "Own"));
    if (!cards) throw new Error("expected candidates");
    expect(cards.map((card) => card.topic)).toEqual(["과일", "도시", "도시"]);
    expect(parseContent(cards[1]?.front)?.[0]).toMatchObject({ kind: "cloze", answers: ["수도"] });
    expect(parseContent(cards[2]?.front)?.[1]).toMatchObject({ kind: "table", spans: [] });
    expect(parseContent(cards[1]?.back)).toEqual([]);
    const saving = cards
      .slice(0, 2)
      .flatMap((card) => cardsOf(card, defaultForm(card.kind, card.identify)));
    expect(await saveCards(uuidOf("own"), saving, "import")).toEqual({ saved: true });
    expect(db.rows.cards).toHaveLength(2);
    expect(db.rows.cards.every((card) => card.source === "import")).toBe(true);
    expect(
      parseCandidates({
        cards: [
          {
            kind: "note",
            type: "cloze",
            front: "___ ___",
            topic: "x",
            cloze: { answers: ["one"] },
          },
        ],
      }),
    ).toBeNull();
    expect(cardKey([{ kind: "text", text: "  Ａpple\n PIE " }])).toBe("apple pie");
  });
  it("reads the current period's remaining quota and refuses malformed rows beside a valid exhausted allowance", async () => {
    server.use(
      http.post(`${supabaseUrl}/rest/v1/rpc/extraction_allowance`, () =>
        HttpResponse.json([{ photo_limit: 10, period: "month", used: 3 }]),
      ),
    );
    expect(await readAllowance()).toEqual({ remaining: 7, limit: 10, period: "month" });
    server.use(
      http.post(`${supabaseUrl}/rest/v1/rpc/extraction_allowance`, () =>
        HttpResponse.json([{ photo_limit: 10, period: "month", used: 10 }]),
      ),
    );
    expect(await readAllowance()).toEqual({ remaining: 0, limit: 10, period: "month" });
    server.use(
      http.post(`${supabaseUrl}/rest/v1/rpc/extraction_allowance`, () =>
        HttpResponse.json([{ photo_limit: 10, period: "year", used: 0 }]),
      ),
    );
    expect(await readAllowance()).toBeNull();
  });
});
