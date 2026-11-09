import { unzipSync } from "fflate";
import { Decompress } from "fzstd";
import type { Database, SqlJsStatic } from "sql.js";

import { loadSqlite } from "./anki-sqlite";
import type { Refusal } from "./spreadsheet";

/** The largest package read, refused by its size before a byte of it is read (ADR 0223). */
export const packageLimitBytes = 100 * 1024 * 1024;
/** The most a package's collection may unpack to. */
export const collectionLimitBytes = 100 * 1024 * 1024;
/** The most notes one Anki deck may hold, as the spreadsheet's row limit. */
export const deckNoteLimit = 1000;
/** The most any other part of a package, its media list or one media file, may unpack to. */
const partLimitBytes = 50 * 1024 * 1024;

/**
 * How an Anki note type reads: the stock Basic, two fields on one card template; a Cloze; or any
 * other, whose first two fields are read as a Basic's (ADR 0222).
 */
export type NoteKind = "basic" | "cloze" | "other";
/** An Anki note: its id, its kind and its fields' HTML, in the note type's order. */
export type AnkiNote = { id: number; kind: NoteKind; fields: string[] };
/** An Anki deck holding notes, named as Anki names it, `::` between a deck and its parent. */
export type AnkiDeck = { name: string; notes: AnkiNote[] };
/** The decks of a package, and the media file each name in a note's HTML stands for. */
export type AnkiPackage = {
  decks: AnkiDeck[];
  /** A media file's bytes by its name, or null where the package holds none under it or it cannot be read. */
  readMedia: (name: string) => Uint8Array | null;
};

const notAPackage: Refusal = { refused: ".apkg 파일을 골라 주세요" };
const tooBig: Refusal = {
  refused: `파일이 ${String(packageLimitBytes / 1024 / 1024)}MB보다 커서 읽지 못했어요. 덱을 나눠 다시 내보낸 뒤 골라 주세요.`,
};
const collectionTooBig: Refusal = {
  refused: `덱의 크기가 ${String(collectionLimitBytes / 1024 / 1024)}MB보다 커서 읽지 못했어요. 덱을 나눠 다시 내보낸 뒤 골라 주세요.`,
};
const unreadable: Refusal = {
  refused: "Anki 패키지를 읽지 못했어요. Anki에서 .apkg로 다시 내보내 골라 주세요.",
};
const empty: Refusal = { refused: "가져올 노트가 없어요. 노트가 있는 덱을 골라 내보내 주세요." };

/** A part that unpacks past its limit. */
class OverLimit extends Error {}
/** A deck that holds more notes than the limit. */
class TooManyNotes extends Error {
  constructor(readonly deck: string) {
    super(deck);
  }
}

/**
 * Opens an Anki `.apkg` in the browser, refusing a package over the size limit before reading it. A
 * package is a zip: `collection.anki2` or `collection.anki21`, plain SQLite, in the legacy
 * versions, `collection.anki21b`, zstd-compressed, in the latest, with the media apart (ADR 0223).
 */
export async function openAnkiPackage(
  file: File,
  sqlite: () => Promise<SqlJsStatic> = loadSqlite,
): Promise<AnkiPackage | Refusal> {
  if (!file.name.toLowerCase().endsWith(".apkg")) return notAPackage;
  if (file.size > packageLimitBytes) return tooBig;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const parts = unzipSync(bytes, {
      filter: (part) => {
        if (part.originalSize > packageLimitBytes) throw new OverLimit();
        return true;
      },
    });
    const latest = parts["collection.anki21b"];
    const plain = parts["collection.anki21"] ?? parts["collection.anki2"];
    const collection = latest ? unzstd(latest, collectionLimitBytes) : plain;
    if (!collection) return unreadable;
    const SQL = await sqlite();
    const db = new SQL.Database(collection);
    let decks: AnkiDeck[];
    try {
      decks = latest ? readLatest(db) : readLegacy(db);
    } finally {
      db.close();
    }
    if (decks.length === 0) return empty;
    const media = mediaNames(parts, latest !== undefined);
    return {
      decks,
      readMedia: (name) => {
        const index = media.get(name);
        const data = index === undefined ? undefined : parts[index];
        if (!data) return null;
        try {
          return latest ? unzstd(data, partLimitBytes) : data;
        } catch {
          return null;
        }
      },
    };
  } catch (error) {
    if (error instanceof OverLimit) return collectionTooBig;
    if (error instanceof TooManyNotes) {
      return {
        refused: `'${error.deck}' 덱에 노트가 ${String(deckNoteLimit)}개보다 많아서 읽지 못했어요. 덱을 나눠 다시 내보낸 뒤 골라 주세요.`,
      };
    }
    return unreadable;
  }
}

/** Decompresses zstd, refusing at once a stream that grows past the limit, not after it has. */
function unzstd(data: Uint8Array, limit: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const stream = new Decompress((chunk) => {
    size += chunk.length;
    if (size > limit) throw new OverLimit();
    chunks.push(chunk);
  });
  stream.push(data, true);
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** The part of the zip each media file name is stored under. */
function mediaNames(parts: Record<string, Uint8Array>, latest: boolean): Map<string, string> {
  const names = new Map<string, string>();
  const list = parts.media;
  if (!list) return names;
  if (latest) {
    // A `MediaEntries` message: repeated field 1, a message whose field 1 is the name; the
    // entry's place in the list is the zip part's name.
    const entries = fields(unzstd(list, partLimitBytes)).filter((f) => f.number === 1 && f.bytes);
    entries.forEach((entry, index) => {
      const name = fields(entry.bytes ?? new Uint8Array()).find((f) => f.number === 1 && f.bytes);
      if (name?.bytes) names.set(new TextDecoder().decode(name.bytes), String(index));
    });
    return names;
  }
  const map = JSON.parse(new TextDecoder().decode(list)) as unknown;
  if (typeof map !== "object" || map === null) return names;
  for (const [part, name] of Object.entries(map)) {
    if (typeof name === "string") names.set(name, part);
  }
  return names;
}

type Field = { number: number; bytes?: Uint8Array };

/** The top-level fields of a protobuf message, a varint or a length-delimited one kept as bytes. */
function fields(data: Uint8Array): Field[] {
  const out: Field[] = [];
  let at = 0;
  const varint = (): number => {
    let value = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      const byte = data[at++];
      if (byte === undefined) throw new Error("truncated protobuf");
      value += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return value;
    }
    throw new Error("protobuf varint too long");
  };
  while (at < data.length) {
    const tag = varint();
    const wire = tag % 8;
    const number = Math.floor(tag / 8);
    if (wire === 0) {
      varint();
      out.push({ number });
    } else if (wire === 2) {
      const length = varint();
      if (at + length > data.length) throw new Error("truncated protobuf");
      out.push({ number, bytes: data.subarray(at, at + length) });
      at += length;
    } else if (wire === 1) {
      at += 8;
    } else if (wire === 5) {
      at += 4;
    } else {
      throw new Error("unsupported protobuf wire type");
    }
  }
  return out;
}

type Row = (number | string | Uint8Array | null)[];

function rows(db: Database, sql: string): Row[] {
  return db.exec(sql)[0]?.values ?? [];
}

const cloze = "{{cloze:";

/** What a note type is: a Cloze, the stock Basic's two fields on one template, or any other. */
function kindOf(clozeType: boolean, fieldCount: number, templateCount: number): NoteKind {
  if (clozeType) return "cloze";
  return fieldCount === 2 && templateCount === 1 ? "basic" : "other";
}

/** The decks of schema 18, the latest package's collection, as `notetypes`, `decks` and `notes` tables. */
function readLatest(db: Database): AnkiDeck[] {
  const fieldCounts = new Map(
    rows(db, "select ntid, count(*) from fields group by ntid").map((r) => [
      Number(r[0]),
      Number(r[1]),
    ]),
  );
  const templates = new Map<number, { count: number; cloze: boolean }>();
  for (const [ntid, config] of rows(db, "select ntid, config from templates")) {
    const seen = templates.get(Number(ntid)) ?? { count: 0, cloze: false };
    seen.count += 1;
    if (config instanceof Uint8Array && new TextDecoder().decode(config).includes(cloze))
      seen.cloze = true;
    templates.set(Number(ntid), seen);
  }
  const kinds = new Map<number, NoteKind>();
  for (const [id] of rows(db, "select id from notetypes")) {
    const t = templates.get(Number(id));
    kinds.set(
      Number(id),
      kindOf(t?.cloze ?? false, fieldCounts.get(Number(id)) ?? 0, t?.count ?? 0),
    );
  }
  const names = new Map(
    rows(db, "select id, name from decks").map((r) => [
      Number(r[0]),
      String(r[1]).replaceAll("\x1f", "::"),
    ]),
  );
  return collect(
    db,
    (id) => names.get(id),
    (mid) => kinds.get(mid),
  );
}

/** The decks of the legacy collections, whose note types and decks are JSON in the `col` row. */
function readLegacy(db: Database): AnkiDeck[] {
  const [models, decks] = rows(db, "select models, decks from col")[0] ?? [];
  const parse = (json: unknown): Record<string, Record<string, unknown>> =>
    typeof json === "string" ? (JSON.parse(json) as Record<string, Record<string, unknown>>) : {};
  const types = parse(models);
  const names = parse(decks);
  return collect(
    db,
    (id) => {
      const name = names[String(id)]?.name;
      return typeof name === "string" ? name : undefined;
    },
    (mid) => {
      const type = types[String(mid)];
      if (!type) return undefined;
      const tmpls = Array.isArray(type.tmpls) ? (type.tmpls as { qfmt?: unknown }[]) : [];
      const flds = Array.isArray(type.flds) ? type.flds.length : 0;
      const isCloze =
        type.type === 1 || tmpls.some((t) => typeof t.qfmt === "string" && t.qfmt.includes(cloze));
      return kindOf(isCloze, flds, tmpls.length);
    },
  );
}

/** Groups notes by the deck of their first card, refusing a deck over the note limit. */
function collect(
  db: Database,
  deckName: (id: number) => string | undefined,
  kindOfType: (id: number) => NoteKind | undefined,
): AnkiDeck[] {
  const home = new Map<number, number>();
  for (const [nid, did] of rows(db, "select nid, did from cards order by ord, id")) {
    if (!home.has(Number(nid))) home.set(Number(nid), Number(did));
  }
  const decks = new Map<string, AnkiNote[]>();
  for (const [id, mid, flds] of rows(db, "select id, mid, flds from notes order by id")) {
    const name = deckName(home.get(Number(id)) ?? -1);
    const kind = kindOfType(Number(mid));
    if (name === undefined || kind === undefined) continue;
    const notes = decks.get(name) ?? [];
    notes.push({ id: Number(id), kind, fields: String(flds).split("\x1f") });
    if (notes.length > deckNoteLimit) throw new TooManyNotes(name);
    decks.set(name, notes);
  }
  return [...decks].map(([name, notes]) => ({ name, notes }));
}
