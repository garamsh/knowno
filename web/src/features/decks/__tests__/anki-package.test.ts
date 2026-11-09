// @vitest-environment node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { zipSync } from "fflate";
import type { Database } from "sql.js";
import { describe, expect, it } from "vitest";

import {
  deckNoteLimit,
  openAnkiPackage,
  packageLimitBytes,
  type AnkiPackage,
} from "../anki-package";

const require = createRequire(import.meta.url);
const sqlite = () => (require("sql.js/dist/sql-wasm.js") as () => Promise<never>)();

function fixture(name: string): File {
  return new File([readFileSync(`e2e/fixtures/anki/${name}`)], name);
}

const refusing = (text: string) => ({ refused: expect.stringContaining(text) as string });

async function open(file: File): Promise<AnkiPackage> {
  const result = await openAnkiPackage(file, sqlite);
  if ("refused" in result) throw new Error(result.refused);
  return result;
}

describe.each(["spanish-latest.apkg", "spanish-legacy.apkg"])("%s", (name) => {
  it("reads one deck per Anki deck, each note with its kind and fields", async () => {
    const pkg = await open(fixture(name));
    const byName = Object.fromEntries(pkg.decks.map((d) => [d.name, d.notes]));
    expect(Object.keys(byName).sort()).toEqual(["Spanish", "Spanish::Verbs"]);
    expect(byName.Spanish?.map((n) => [n.kind, n.fields[0]])).toEqual([
      ["basic", "<b>hablar</b>"],
      ["basic", '<img src="red.png">'],
    ]);
    expect(byName["Spanish::Verbs"]?.map((n) => n.kind)).toEqual(["cloze", "other"]);
    expect(byName["Spanish::Verbs"]?.[0]?.fields).toEqual([
      "Madrid is the capital of {{c1::Spain::country}}",
      "an extra",
    ]);
  });

  it("reads a media file by the name its HTML uses, and null for one the package lacks", async () => {
    const pkg = await open(fixture(name));
    expect(Array.from(pkg.readMedia("red.png")?.subarray(1, 4) ?? [])).toEqual([0x50, 0x4e, 0x47]);
    expect(pkg.readMedia("missing.png")).toBeNull();
  });
});

describe("refusals", () => {
  it("refuses a file that is not an .apkg by its name", async () => {
    expect(await openAnkiPackage(new File(["x"], "a.zip"), sqlite)).toEqual(refusing(".apkg"));
  });

  it("refuses a package over the size limit without reading it", async () => {
    const big = { name: "a.apkg", size: packageLimitBytes + 1 } as File;
    expect(await openAnkiPackage(big, sqlite)).toEqual(refusing("100MB"));
  });

  it("refuses bytes that are not a zip with a sentence", async () => {
    expect(await openAnkiPackage(new File(["not a zip"], "a.apkg"), sqlite)).toEqual(
      refusing("읽지 못했어요"),
    );
  });

  it("refuses a collection that unpacks past the limit, stopping the stream when it does", async () => {
    // A zstd frame of 900 run-length blocks of 128 KiB: a few kilobytes that unpack to 112 MiB.
    const block = new Uint8Array([0x03 | (1 << 1), 0x00, 0x10, 0x61]);
    const header = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x58]);
    const blocks = Array.from({ length: 900 }, (_, i) =>
      i === 899 ? block : new Uint8Array([0x02, 0x00, 0x10, 0x61]),
    );
    const frame = new Uint8Array(header.length + blocks.length * 4);
    frame.set(header);
    blocks.forEach((b, i) => {
      frame.set(b, header.length + i * 4);
    });
    const zip = zipSync({ "collection.anki21b": [frame, { level: 0 }] });
    expect(await openAnkiPackage(new File([zip], "a.apkg"), sqlite)).toEqual(refusing("덱의 크기"));
  });

  it("refuses a deck holding more notes than the limit, naming it", async () => {
    const SQL = await sqlite();
    const db = new (SQL as unknown as { Database: new () => Database }).Database();
    db.run("create table col (models text, decks text)");
    db.run("create table notes (id integer, mid integer, flds text)");
    db.run("create table cards (id integer, nid integer, did integer, ord integer)");
    db.run("insert into col values (?, ?)", [
      JSON.stringify({
        "1": { name: "Basic", type: 0, flds: [{}, {}], tmpls: [{ qfmt: "{{Front}}" }] },
      }),
      JSON.stringify({ "9": { name: "Big" } }),
    ]);
    for (let id = 1; id <= deckNoteLimit + 1; id++) {
      db.run("insert into notes values (?, 1, ?)", [id, "a\x1fb"]);
      db.run("insert into cards values (?, ?, 9, 0)", [id, id]);
    }
    const zip = zipSync({ "collection.anki2": db.export() });
    expect(await openAnkiPackage(new File([zip], "a.apkg"), sqlite)).toEqual(refusing("'Big'"));
  });
});
