import { createHash } from "node:crypto";

import { http, HttpResponse } from "msw";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { cardRow, deckRow, uuidOf } from "@/testing/library";
import { otherUser, supabaseUrl, testAccessToken, testUser } from "@/testing/mocks/handlers";
import { FakePostgrest } from "@/testing/mocks/postgrest";
import { FakePublishNote } from "@/testing/mocks/publish-note";
import { server } from "@/testing/mocks/server";
import { FakeStorage } from "@/testing/mocks/storage";
import { setRequestCookies } from "@/testing/next-headers";
import { signedInCookies } from "@/testing/session";

import { decorateDeck } from "../decorate-deck";
import { deleteDeck } from "../delete-deck";
import { publishDeck, unpublishDeck } from "../publish-deck";
import { readDeckList, readLibrary } from "../read-library";
import { renameDeck } from "../rename-deck";

vi.mock("next/headers", () => import("@/testing/next-headers"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.spyOn(console, "error").mockImplementation(() => undefined);

let db: FakePostgrest;
let storage: FakeStorage;
let publishNote: FakePublishNote;
beforeEach(async () => {
  db = new FakePostgrest();
  storage = new FakeStorage(db);
  publishNote = new FakePublishNote(db);
  server.use(...db.handlers, ...storage.handlers, ...publishNote.handlers);
  setRequestCookies(await signedInCookies());
});

/** A media row and its object in the test user's folder, as an upload left them. */
function storedMedia(id: string, owner = testUser.id) {
  db.rows.media.push({
    user_id: owner,
    id,
    kind: "image",
    mime_type: "image/jpeg",
    byte_size: 3,
    sha256: "0".repeat(64),
  });
  storage.seed(`${owner}/${id}`);
}

/** A photo 노트 꾸미기 prepared: a JPEG's bytes. */
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const digest = createHash("sha256").update(jpeg).digest("hex");

/** 노트 꾸미기's form for deck [deck], with [image] and its fields. */
function decoration(
  deck: string,
  image: "keep" | "remove" | { bytes: Uint8Array<ArrayBuffer>; sha256: string },
  { icon = "book", color = "sand" } = {},
) {
  const form = new FormData();
  form.set("deck", uuidOf(deck));
  form.set("icon", icon);
  form.set("color", color);
  if (typeof image === "string") form.set("image", image);
  else {
    form.set("image", new Blob([image.bytes], { type: "image/jpeg" }), "image.jpg");
    form.set("sha256", image.sha256);
  }
  return form;
}

/** A card side holding a photo of media [id]. */
const photoSide = (id: string) => [
  { type: "image", v: 1, id: "b1", payload: { media: id, width: 10, height: 10, boxes: [] } },
];

describe("이름 바꾸기", () => {
  it("renames the user's live note, trimmed, and refuses an empty name, a deleted note and a foreign one", async () => {
    db.seed("decks", deckRow("own", "Old"), deckRow("gone", "Gone", true), {
      ...deckRow("foreign", "Foreign"),
      user_id: otherUser.id,
    });
    expect(await renameDeck(uuidOf("own"), "  ")).toMatchObject({ saved: false });
    expect(await renameDeck(uuidOf("own"), "x".repeat(501))).toMatchObject({ saved: false });
    expect(await renameDeck(uuidOf("gone"), "New")).toMatchObject({ saved: false });
    expect(await renameDeck(uuidOf("foreign"), "New")).toMatchObject({ saved: false });
    expect(db.rows.decks.map((row) => row.name)).toEqual(["Old", "Gone", "Foreign"]);
    // Control: the same write to the user's live note is taken.
    expect(await renameDeck(uuidOf("own"), "  New  ")).toEqual({ saved: true });
    expect(db.rows.decks[0]).toMatchObject({ name: "New" });
    expect(Date.parse(String(db.rows.decks[0]?.updated_at))).toBeGreaterThan(
      Date.parse(deckRow("own", "Old").updated_at),
    );
  });
});

describe("노트 꾸미기", () => {
  it("stores the icon and colour, and no colour as none", async () => {
    db.seed("decks", deckRow("deck", "Deck"));
    expect(
      await decorateDeck(decoration("deck", "keep", { icon: "star", color: "violet" })),
    ).toEqual({
      saved: true,
    });
    expect(db.rows.decks[0]).toMatchObject({ icon: "star", color: "violet", image_media_id: null });
    expect(await decorateDeck(decoration("deck", "keep", { color: "" }))).toEqual({ saved: true });
    expect(db.rows.decks[0]).toMatchObject({ icon: "book", color: null });
  });

  it("refuses an icon or a colour this version does not know against a known pair", async () => {
    db.seed("decks", deckRow("deck", "Deck"));
    expect(await decorateDeck(decoration("deck", "keep", { icon: "rocket" }))).toMatchObject({
      saved: false,
    });
    expect(await decorateDeck(decoration("deck", "keep", { color: "teal" }))).toMatchObject({
      saved: false,
    });
    expect(db.requests.filter((request) => request.startsWith("PATCH"))).toEqual([]);
    expect(await decorateDeck(decoration("deck", "keep", { color: "amber" }))).toEqual({
      saved: true,
    });
  });

  it("stores a new photo as its media row, then its file, then the note, then releases the photo it replaces", async () => {
    const old = uuidOf("old-photo");
    db.seed("decks", { ...deckRow("deck", "Deck"), image_media_id: old });
    storedMedia(old);
    db.requests.length = 0;

    expect(await decorateDeck(decoration("deck", { bytes: jpeg, sha256: digest }))).toEqual({
      saved: true,
    });

    const next = String(db.rows.decks[0]?.image_media_id);
    expect(next).not.toBe(old);
    expect(db.rows.media).toEqual([
      expect.objectContaining({
        user_id: testUser.id,
        id: next,
        kind: "image",
        mime_type: "image/jpeg",
        byte_size: jpeg.byteLength,
        sha256: digest,
      }),
    ]);
    expect(storage.objects.get(`${testUser.id}/${next}`)?.bytes).toEqual(jpeg);
    expect(storage.objects.has(`${testUser.id}/${old}`)).toBe(false);
    expect(
      db.requests.filter((request) => request !== "GET cards" && request !== "GET decks"),
    ).toEqual([
      "POST media",
      "POST storage upload",
      "PATCH decks",
      "DELETE storage remove",
      "DELETE media",
    ]);
  });

  it("keeps a replaced photo another live note still holds, against one no note holds released", async () => {
    const shared = uuidOf("shared");
    db.seed(
      "decks",
      { ...deckRow("deck", "Deck"), image_media_id: shared },
      { ...deckRow("copy", "Copy"), image_media_id: shared },
      { ...deckRow("card-deck", "Cards") },
    );
    const onCard = uuidOf("on-card");
    db.seed("cards", { ...cardRow("card", "card-deck", "photo"), front: photoSide(onCard) });
    db.rows.decks[2] = { ...db.rows.decks[2], image_media_id: onCard };
    storedMedia(shared);
    storedMedia(onCard);

    expect(await decorateDeck(decoration("deck", "remove"))).toEqual({ saved: true });
    expect(await decorateDeck(decoration("card-deck", "remove"))).toEqual({ saved: true });
    expect(storage.objects.has(`${testUser.id}/${shared}`)).toBe(true);
    expect(storage.objects.has(`${testUser.id}/${onCard}`)).toBe(true);

    // Control: once the copy lets it go too, nothing holds it, and it is released.
    expect(await decorateDeck(decoration("copy", "remove"))).toEqual({ saved: true });
    expect(storage.objects.has(`${testUser.id}/${shared}`)).toBe(false);
    expect(db.rows.media.map((row) => row.id)).toEqual([onCard]);
  });

  it("leaves the note and its photo as they were when the upload fails, and says so", async () => {
    const old = uuidOf("old-photo");
    db.seed("decks", { ...deckRow("deck", "Deck"), image_media_id: old, icon: "layers" });
    storedMedia(old);
    const release = storage.fail("upload");

    expect(await decorateDeck(decoration("deck", { bytes: jpeg, sha256: digest }))).toEqual({
      saved: false,
      message: "사진을 저장하지 못했어요. 노트는 그대로예요. 다시 시도해 주세요.",
    });
    expect(db.rows.decks[0]).toMatchObject({ image_media_id: old, icon: "layers" });
    expect(storage.objects.has(`${testUser.id}/${old}`)).toBe(true);
    // The new photo's row, which nothing names, goes with its failed upload.
    expect(db.rows.media.map((row) => row.id)).toEqual([old]);

    // Control: the same save once Storage takes the file.
    release();
    expect(await decorateDeck(decoration("deck", { bytes: jpeg, sha256: digest }))).toEqual({
      saved: true,
    });
    expect(db.rows.decks[0]?.image_media_id).not.toBe(old);
  });

  it("keeps the new photo when releasing the old one fails, leaving the old file in place", async () => {
    const old = uuidOf("old-photo");
    db.seed("decks", { ...deckRow("deck", "Deck"), image_media_id: old });
    storedMedia(old);
    storage.fail("remove");

    expect(await decorateDeck(decoration("deck", { bytes: jpeg, sha256: digest }))).toEqual({
      saved: true,
    });
    expect(db.rows.decks[0]?.image_media_id).not.toBe(old);
    expect(storage.objects.has(`${testUser.id}/${old}`)).toBe(true);
    expect(db.rows.media.map((row) => row.id)).toContain(old);
  });

  it("refuses a photo whose digest is not its bytes', or that is not a JPEG, against the same photo whole", async () => {
    db.seed("decks", deckRow("deck", "Deck"));
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    for (const image of [
      { bytes: jpeg, sha256: "f".repeat(64) },
      { bytes: png, sha256: createHash("sha256").update(png).digest("hex") },
    ])
      expect(await decorateDeck(decoration("deck", image))).toMatchObject({ saved: false });
    expect(db.rows.media).toEqual([]);
    expect(storage.objects.size).toBe(0);
    expect(await decorateDeck(decoration("deck", { bytes: jpeg, sha256: digest }))).toEqual({
      saved: true,
    });
    expect(storage.objects.size).toBe(1);
  });
});

describe("노트 공개", () => {
  it("publishes through publish-note with the trimmed description and the display name asked for, writing no deck row, and makes the note private again keeping the description", async () => {
    db.seed("decks", deckRow("deck", "Deck"));
    expect(await publishDeck(uuidOf("deck"), "  토익 단어  ", " 가람 ")).toEqual({ saved: true });
    expect(db.rows.profiles).toEqual([
      expect.objectContaining({ user_id: testUser.id, display_name: "가람" }),
    ]);
    expect(publishNote.calls).toEqual([
      {
        authorization: `Bearer ${testAccessToken}`,
        body: { deck_id: uuidOf("deck"), description: "토익 단어" },
      },
    ]);
    // The only write the web made is the profile's: no request wrote the deck.
    expect(
      db.requests.filter((request) => request.endsWith(" decks") && request !== "GET decks"),
    ).toEqual([]);
    expect(db.rows.decks[0]).toMatchObject({ visibility: "public", description: "토익 단어" });

    expect(await unpublishDeck(uuidOf("deck"))).toEqual({ saved: true });
    expect(db.rows.decks[0]).toMatchObject({
      visibility: "private",
      published_at: null,
      description: "토익 단어",
    });
  });

  it("saves only a public answer: checking, held and refused say so and leave the note private, against the same publish answered public", async () => {
    db.seed("decks", deckRow("deck", "Deck"));
    const said = new Set<unknown>();
    for (const state of ["checking", "held", "refused"]) {
      publishNote.state = state;
      const result = await publishDeck(uuidOf("deck"), "");
      expect(result).toMatchObject({ saved: false });
      said.add("message" in result ? result.message : null);
      expect(db.rows.decks[0]).toMatchObject({ visibility: "private" });
    }
    expect(said.size).toBe(3);
    publishNote.state = "public";
    expect(await publishDeck(uuidOf("deck"), "")).toEqual({ saved: true });
    expect(db.rows.decks[0]).toMatchObject({ visibility: "public" });
  });

  it("reports a failure for an unreachable function, a 502, a 401, a 403, a 404 and an answer with no state, leaving the note private", async () => {
    db.seed("decks", deckRow("deck", "Deck"));
    publishNote.unreachable = true;
    expect(await publishDeck(uuidOf("deck"), "")).toMatchObject({ saved: false });
    publishNote.unreachable = false;
    for (const [status, message] of [
      [401, "다시 로그인해 주세요"],
      [403, "이 노트는 공개할 수 없어요."],
      [404, "이 노트는 삭제됐어요. 다른 노트를 골라 주세요."],
      [502, "지금은 처리할 수 없어요. 잠시 후 다시 시도해 주세요."],
    ] as const) {
      publishNote.status = status;
      expect(await publishDeck(uuidOf("deck"), "")).toEqual({ saved: false, message });
    }
    publishNote.status = undefined;
    server.use(
      http.post(`${supabaseUrl}/functions/v1/publish-note`, () => HttpResponse.json({ ok: true })),
    );
    expect(await publishDeck(uuidOf("deck"), "")).toMatchObject({ saved: false });
    expect(db.rows.decks[0]).toMatchObject({ visibility: "private" });
  });

  it("refuses a display name outside 2 to 20 characters and a description over 300 before any request, against both at their bounds", async () => {
    db.seed("decks", deckRow("deck", "Deck"));
    for (const [description, name] of [
      ["", "가"],
      ["", "가".repeat(21)],
      ["가".repeat(301), "가람"],
    ] as const)
      expect(await publishDeck(uuidOf("deck"), description, name)).toMatchObject({ saved: false });
    expect(db.rows.decks[0]).toMatchObject({ visibility: "private" });
    expect(db.rows.profiles).toEqual([]);
    expect(publishNote.calls).toEqual([]);
    expect(await publishDeck(uuidOf("deck"), "가".repeat(300), "가".repeat(20))).toEqual({
      saved: true,
    });
    expect(db.rows.decks[0]).toMatchObject({ visibility: "public" });
  });

  it("publishes without writing a name when none is given, sending no description for an empty one, and refuses a deleted note", async () => {
    db.seed("decks", deckRow("deck", "Deck"), deckRow("gone", "Gone", true));
    expect(await publishDeck(uuidOf("gone"), "")).toMatchObject({ saved: false });
    expect(await publishDeck(uuidOf("deck"), "")).toEqual({ saved: true });
    expect(db.rows.profiles).toEqual([]);
    expect(db.rows.decks.map((row) => row.visibility)).toEqual(["public", "private"]);
    expect(publishNote.calls.map((call) => call.body)).toEqual([
      { deck_id: uuidOf("gone"), description: null },
      { deck_id: uuidOf("deck"), description: null },
    ]);
  });
});

describe("노트 삭제", () => {
  it("tombstones the note and its live cards at one time, cards first, leaving another note's cards", async () => {
    db.seed("decks", deckRow("deck", "Deck"), deckRow("other", "Other"));
    db.seed(
      "cards",
      cardRow("a", "deck", "a"),
      cardRow("b", "deck", "b"),
      cardRow("c", "other", "c"),
    );
    db.requests.length = 0;

    expect(await deleteDeck(uuidOf("deck"))).toEqual({ deleted: true });

    const at = db.rows.decks[0]?.deleted_at;
    expect(typeof at).toBe("string");
    expect(db.rows.decks[0]?.updated_at).toBe(at);
    expect(db.rows.cards.map((row) => row.deleted_at)).toEqual([at, at, null]);
    expect(db.rows.cards.map((row) => row.updated_at === at)).toEqual([true, true, false]);
    expect(db.rows.decks[1]).toMatchObject({ deleted_at: null });
    expect(db.requests.slice(0, 2)).toEqual(["PATCH cards", "PATCH decks"]);
  });

  it("releases the note's photo and its cards' photos and sounds that nothing else holds, keeping one another live card holds", async () => {
    const tile = uuidOf("tile");
    const own = uuidOf("own-photo");
    const sound = uuidOf("sound");
    const shared = uuidOf("shared");
    db.seed(
      "decks",
      { ...deckRow("deck", "Deck"), image_media_id: tile },
      deckRow("other", "Other"),
    );
    db.seed(
      "cards",
      { ...cardRow("photo", "deck", "p"), front: photoSide(own) },
      {
        ...cardRow("sound", "deck", "s"),
        front: [{ type: "audio", v: 1, id: "b2", payload: { media: sound, duration_ms: 1000 } }],
      },
      { ...cardRow("shared", "deck", "x"), front: photoSide(shared) },
      { ...cardRow("keeper", "other", "y"), front: photoSide(shared) },
    );
    for (const id of [tile, own, sound, shared]) storedMedia(id);

    expect(await deleteDeck(uuidOf("deck"))).toEqual({ deleted: true });

    expect([...storage.objects.keys()]).toEqual([`${testUser.id}/${shared}`]);
    expect(db.rows.media.map((row) => row.id)).toEqual([shared]);
  });

  it("leaves the deletion standing when the release fails", async () => {
    const tile = uuidOf("tile");
    db.seed("decks", { ...deckRow("deck", "Deck"), image_media_id: tile });
    storedMedia(tile);
    storage.fail("remove");

    expect(await deleteDeck(uuidOf("deck"))).toEqual({ deleted: true });
    expect(db.rows.decks[0]?.deleted_at).not.toBeNull();
    expect(storage.objects.has(`${testUser.id}/${tile}`)).toBe(true);
  });

  it("refuses a foreign or deleted note and a signed-out request, against the user's live note", async () => {
    db.seed(
      "decks",
      { ...deckRow("foreign", "Foreign"), user_id: otherUser.id },
      deckRow("gone", "Gone", true),
      deckRow("own", "Own"),
    );
    db.seed("cards", { ...cardRow("theirs", "foreign", "t"), user_id: otherUser.id });
    expect(await deleteDeck(uuidOf("foreign"))).toMatchObject({ deleted: false });
    expect(await deleteDeck(uuidOf("gone"))).toMatchObject({ deleted: false });
    expect(await deleteDeck("not-a-uuid")).toMatchObject({ deleted: false });
    expect(db.rows.cards[0]).toMatchObject({ deleted_at: null });
    setRequestCookies([]);
    expect(await deleteDeck(uuidOf("own"))).toMatchObject({ deleted: false });
    expect(db.rows.decks[2]).toMatchObject({ deleted_at: null });
    setRequestCookies(await signedInCookies());
    expect(await deleteDeck(uuidOf("own"))).toEqual({ deleted: true });
  });
});

describe("a note's photo in the reads that list notes", () => {
  it("gives a note whose photo Storage holds a URL signed for the user, and none to one whose file is gone", async () => {
    const held = uuidOf("held");
    db.seed(
      "decks",
      { ...deckRow("photo", "A"), image_media_id: held },
      { ...deckRow("missing", "B"), image_media_id: uuidOf("missing") },
      deckRow("plain", "C"),
    );
    storedMedia(held);

    const list = await readDeckList();
    if (!("library" in list)) throw new Error("the list was not read");
    expect(list.library.decks.map((deck) => deck.imageUrl)).toEqual([
      `http://supabase.test/storage/v1/object/sign/media/${testUser.id}/${held}?token=signed`,
      undefined,
      undefined,
    ]);
    const note = await readLibrary([uuidOf("photo") as never]);
    if (!("library" in note)) throw new Error("the note was not read");
    expect(note.library.decks[0]?.imageUrl).toContain(`/object/sign/media/${testUser.id}/${held}`);
  });

  it("reads the notes with their icons when signing fails", async () => {
    db.seed("decks", { ...deckRow("photo", "A"), image_media_id: uuidOf("held") });
    storedMedia(uuidOf("held"));
    storage.fail("sign");
    const list = await readDeckList();
    expect(list).toMatchObject({ library: { decks: [expect.objectContaining({ name: "A" })] } });
    if ("library" in list) expect(list.library.decks[0]?.imageUrl).toBeUndefined();
  });
});

describe("a card's photos and sounds in a note's read", () => {
  const sound = (id: string) => [
    { type: "audio", v: 1, id: "s1", payload: { media: id, duration_ms: 900 } },
  ];

  it("signs each photo and sound Storage holds in one request, on its 칸 and its side, and none to one whose file is gone", async () => {
    const photo = uuidOf("photo");
    const voice = uuidOf("voice");
    db.seed("decks", deckRow("deck", "A"));
    db.seed(
      "cards",
      { ...cardRow("c1", "deck", "x"), front: photoSide(photo), back: sound(voice) },
      { ...cardRow("c2", "deck", "y"), front: photoSide(uuidOf("gone")) },
    );
    storedMedia(photo);
    storedMedia(voice);
    db.requests.length = 0;

    const read = await readLibrary([uuidOf("deck") as never]);
    if (!("library" in read)) throw new Error("the note was not read");
    const [first, second] = read.library.cards;
    const url = (id: string) =>
      `http://supabase.test/storage/v1/object/sign/media/${testUser.id}/${id}?token=signed`;
    expect(first?.front[0]).toMatchObject({ kind: "image", url: url(photo) });
    expect(first?.back[0]).toMatchObject({ kind: "audio", url: url(voice) });
    expect(first?.cells.map((cell) => ("block" in cell ? cell.block : null))).toMatchObject([
      { kind: "image", url: url(photo) },
      { kind: "audio", url: url(voice) },
    ]);
    expect(second?.front[0]).not.toHaveProperty("url");
    expect(db.requests.filter((request) => request === "POST storage sign")).toHaveLength(1);
  });

  it("reads the cards without URLs when signing fails", async () => {
    db.seed("decks", deckRow("deck", "A"));
    db.seed("cards", { ...cardRow("c1", "deck", "x"), front: photoSide(uuidOf("photo")) });
    storedMedia(uuidOf("photo"));
    storage.fail("sign");
    const read = await readLibrary([uuidOf("deck") as never]);
    if (!("library" in read)) throw new Error("the note was not read");
    expect(read.library.cards[0]?.front[0]).not.toHaveProperty("url");
  });
});
