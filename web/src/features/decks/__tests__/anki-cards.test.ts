import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { cardOfNote, cellsOf, imagesOf, importedDeck, noteName, type Photo } from "../anki-cards";
import { openAnkiPackage } from "../anki-package";
import { encodeCells } from "../authoring";
import { frameProblem, parseCells } from "../card-content";

const require = createRequire(import.meta.url);
const sqlite = () => (require("sql.js/dist/sql-wasm.js") as () => Promise<never>)();

async function decks(name: string) {
  const file = new File([readFileSync(`e2e/fixtures/anki/${name}`)], name);
  const pkg = await openAnkiPackage(file, sqlite);
  if ("refused" in pkg) throw new Error(pkg.refused);
  return pkg.decks.map(importedDeck);
}

const photo: Photo = { media: "11111111-1111-4111-8111-111111111111", width: 8, height: 8 };

describe.each(["spanish-latest.apkg", "spanish-legacy.apkg"])("%s", (name) => {
  it("converts a Basic note to a text card of markup, front and back", async () => {
    const [spanish] = await decks(name);
    expect(spanish?.name).toBe("Spanish");
    expect(spanish?.cards[0]).toMatchObject({
      kind: "basic",
      front: "**hablar**",
      back: "to speak\nto talk",
    });
    expect(spanish?.converted).toBe(0);
  });

  it("converts a Cloze note to a cloze card, keeping its hint and dropping the Extra field", async () => {
    const verbs = (await decks(name)).find((deck) => deck.name === "Spanish / Verbs");
    expect(verbs?.cards[0]).toMatchObject({
      kind: "cloze",
      front: "Madrid is the capital of {{c1::Spain::country}}",
      back: "",
    });
  });

  it("converts another note type by its first two fields and counts it", async () => {
    const verbs = (await decks(name)).find((deck) => deck.name === "Spanish / Verbs");
    expect(verbs?.cards[1]).toMatchObject({ kind: "other", front: "uno", back: "one" });
    expect(verbs?.converted).toBe(1);
    expect(verbs?.skipped).toBe(0);
  });

  it("names the images the cards show", async () => {
    expect(imagesOf(await decks(name))).toEqual(["red.png"]);
  });
});

describe("cellsOf", () => {
  const stored = (cells: ReturnType<typeof cellsOf>) => cells && parseCells(encodeCells(cells));

  it("writes a Basic card as one text cell of version 3 that the frame accepts", async () => {
    const [spanish] = await decks("spanish-latest.apkg");
    const cells = stored(cellsOf(spanish!.cards[0]!, new Map()));
    expect(cells).toHaveLength(1);
    expect(cells && frameProblem(cells)).toBeNull();
  });

  it("writes a photo in a field as a 사진 칸 on that side", async () => {
    const [spanish] = await decks("spanish-latest.apkg");
    const cells = stored(cellsOf(spanish!.cards[1]!, new Map([["red.png", photo]])));
    expect(cells?.map((cell) => cell.kind)).toEqual(["placed", "text"]);
    expect(cells?.[0]).toMatchObject({
      side: "front",
      block: { kind: "image", media: photo.media },
    });
  });

  it("leaves out a card whose only front is a photo that is not there", async () => {
    const [spanish] = await decks("spanish-latest.apkg");
    expect(cellsOf(spanish!.cards[1]!, new Map())).toBeNull();
  });

  it("writes a cloze card as a blank cell the engine reads", async () => {
    const verbs = (await decks("spanish-latest.apkg")).find((d) => d.cards[0]?.kind === "cloze");
    const cells = stored(cellsOf(verbs!.cards[0]!, new Map()));
    expect(cells?.[0]).toMatchObject({ kind: "blank", block: { kind: "cloze" } });
    expect(cells && frameProblem(cells)).toBeNull();
  });
});

describe("cardOfNote", () => {
  const note = (kind: "basic" | "cloze" | "other", ...fields: string[]) => ({
    id: 1,
    kind,
    fields,
  });

  it("makes no card of a note with nothing on a side, or a Cloze with no deletion", () => {
    expect(cardOfNote(note("basic", "front", ""))).toBeNull();
    expect(cardOfNote(note("basic", "<br>", "back"))).toBeNull();
    expect(cardOfNote(note("cloze", "no deletion"))).toBeNull();
    expect(cardOfNote(note("other", "only one field"))).toBeNull();
  });
});

describe("noteName", () => {
  it("writes :: as a slash and keeps at most 500 characters", () => {
    expect(noteName("Spanish::Verbs::Irregular")).toBe("Spanish / Verbs / Irregular");
    expect(Array.from(noteName("가".repeat(600)))).toHaveLength(500);
  });
});
