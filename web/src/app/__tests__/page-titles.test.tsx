import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deckRow, start, uuidOf } from "@/testing/library";
import { FakePostgrest } from "@/testing/mocks/postgrest";
import { server } from "@/testing/mocks/server";
import { setRequestCookies } from "@/testing/next-headers";
import { signedInCookies } from "@/testing/session";

import { generateMetadata } from "../(shell)/decks/[id]/page";
import { metadata as todayMetadata } from "../(shell)/page";
import { metadata as studyMetadata } from "../study/page";

vi.mock("next/headers", () => import("@/testing/next-headers"));

const notFound = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };

/** The deck page's title for the address id [id]. */
const deckTitle = async (id: string) =>
  (await generateMetadata({ params: Promise.resolve({ id }) } as PageProps<"/decks/[id]">)).title;

describe("the signed-in pages' titles", () => {
  let postgrest: FakePostgrest;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(start);
    setRequestCookies(await signedInCookies());
    postgrest = new FakePostgrest();
    server.use(...postgrest.handlers);
    postgrest.seed("decks", deckRow("d-fr", "French"), deckRow("d-old", "Old", true));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("names 홈 and the study page", () => {
    expect(todayMetadata.title).toBe("홈 · 알아몰라");
    expect(studyMetadata.title).toBe("학습 · 알아몰라");
  });

  it("names a deck's page by the deck, and is not found for a deleted deck or an id that is no uuid", async () => {
    expect(await deckTitle(uuidOf("d-fr"))).toBe("French · 알아몰라");
    await expect(deckTitle(uuidOf("d-old"))).rejects.toMatchObject(notFound);
    await expect(deckTitle("d-fr")).rejects.toMatchObject(notFound);
  });
});
