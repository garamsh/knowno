import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

import { untilReacted } from "./until-reacted";

// The local stack scripts/test-web.ts starts, whose URL and publishable key the app was built with.
const url = process.env.E2E_SUPABASE_URL;
const key = process.env.E2E_SUPABASE_KEY;
test.skip(
  !url || !key,
  "needs a throwaway local Supabase stack, which sets E2E_SUPABASE_URL and E2E_SUPABASE_KEY",
);

// A package Anki 26.9.4 wrote, made by e2e/fixtures/anki/generate.py: two decks, a Basic note, one
// with a photo, a Cloze note and a reversed note as the other note type.
const fixture = new URL("./fixtures/anki/spanish-latest.apkg", import.meta.url).pathname;

test("adds one note per Anki deck from a package after review, and the server holds them", async ({
  page,
  context,
  baseURL,
}) => {
  if (!url || !key || !baseURL) throw new Error("skipped without local stack");
  const jar = new Map<string, string>();
  const auth = createServerClient(url, key, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) jar.set(name, value);
      },
    },
  });
  const email = `web-anki-${randomUUID()}@example.com`;
  const password = "web-anki-test-password";
  const signup = await auth.auth.signUp({ email, password });
  expect(signup.error).toBeNull();
  const userId = signup.data.user?.id;
  if (!userId) throw new Error("sign-up returned no fixture user");
  await context.addCookies([...jar].map(([name, value]) => ({ name, value, url: baseURL })));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/decks");
  const item = page.getByRole("menuitem", { name: "Anki에서 가져오기", exact: true });
  await untilReacted(
    async () => {
      if (!(await item.isVisible()))
        await page.getByRole("button", { name: "노트 메뉴", exact: true }).click();
      await item.click();
    },
    () => page.getByRole("dialog").isVisible(),
  );
  await expect(page.getByText(/파일은 100MB/u)).toBeVisible();
  await page.getByLabel("파일 고르기", { exact: true }).setInputFiles(fixture);
  await expect(page.getByRole("heading", { name: "노트 확인", exact: true })).toBeVisible();
  await expect(page.getByText(/바꾼 카드가 1장 있어요/u)).toBeVisible();
  // Nothing is written before 추가.
  const client = createClient(url, key, { auth: { persistSession: false } });
  expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull();
  expect((await client.from("decks").select("id").eq("user_id", userId)).data).toEqual([]);

  await page.getByRole("button", { name: "노트 2개, 카드 4장 추가", exact: true }).click();
  await expect(page.getByRole("link", { name: /Spanish \/ Verbs/u })).toBeVisible();

  const decks = await client.from("decks").select("id,name").eq("user_id", userId).order("name");
  expect(decks.error).toBeNull();
  expect(decks.data?.map((deck): unknown => deck.name)).toEqual(["Spanish", "Spanish / Verbs"]);
  const cards = await client
    .from("cards")
    .select("front,source,template,template_version,card_key")
    .eq("user_id", userId);
  expect(cards.error).toBeNull();
  expect(cards.data).toHaveLength(4);
  for (const card of cards.data ?? [])
    expect(card).toMatchObject({ source: "import", template: "free", template_version: 2 });
  const blocks = (cards.data ?? []).flatMap((card) => card.front as { type: string; v: number }[]);
  expect(blocks.filter(({ type }) => type === "image")).toHaveLength(1);
  expect(blocks.filter(({ type }) => type === "cloze").map(({ v }) => v)).toEqual([2]);
  expect(blocks.filter(({ type }) => type === "text").map(({ v }) => v)).toEqual([3, 3, 3]);
  const media = await client.from("media").select("id").eq("user_id", userId);
  expect(media.data).toHaveLength(1);
});
