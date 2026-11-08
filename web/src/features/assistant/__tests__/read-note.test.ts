import { beforeEach, describe, expect, it, vi } from "vitest";

import { deckRow, uuidOf } from "@/testing/library";
import { supabaseUnreachable } from "@/testing/mocks/handlers";
import { FakePostgrest } from "@/testing/mocks/postgrest";
import { server } from "@/testing/mocks/server";
import { setRequestCookies } from "@/testing/next-headers";
import { signedInCookies } from "@/testing/session";

import { readNote } from "../read-note";

vi.mock("next/headers", () => import("@/testing/next-headers"));

let postgrest: FakePostgrest;
beforeEach(async () => {
  setRequestCookies(await signedInCookies());
  postgrest = new FakePostgrest();
  server.use(...postgrest.handlers);
});

describe("the note a chat is opened from", () => {
  it("is the signed-in user's live note, by its id and name", async () => {
    postgrest.seed("decks", deckRow("d-fr", "영단어"));
    expect(await readNote(uuidOf("d-fr"))).toEqual({ id: uuidOf("d-fr"), name: "영단어" });
  });

  it("is none for a note that is deleted, another user's or not there, an id that is none, or a read that failed", async () => {
    postgrest.seed("decks", deckRow("d-gone", "지움", true));
    postgrest.seed("decks", { ...deckRow("d-else", "남의 노트"), user_id: uuidOf("someone-else") });
    postgrest.seed("decks", deckRow("d-fr", "영단어"));
    expect(await readNote(uuidOf("d-gone"))).toBeNull();
    expect(await readNote(uuidOf("d-else"))).toBeNull();
    expect(await readNote(uuidOf("d-none"))).toBeNull();
    const reads = postgrest.selected.length;
    expect(await readNote("not-a-uuid")).toBeNull();
    // An id that is none is refused before any read is made.
    expect(postgrest.selected).toHaveLength(reads);
    expect(await readNote(undefined)).toBeNull();
    expect(await readNote(["a", "b"])).toBeNull();
    // Control: the live note is read, so the others are refused by the read and not by the setup.
    expect(await readNote(uuidOf("d-fr"))).not.toBeNull();
    server.use(supabaseUnreachable);
    expect(await readNote(uuidOf("d-fr"))).toBeNull();
  });
});
