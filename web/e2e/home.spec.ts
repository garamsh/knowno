import { randomUUID } from "node:crypto";

import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

// The local stack scripts/test-web.sh starts, whose URL and publishable key the app was built with.
const url = process.env.E2E_SUPABASE_URL;
const key = process.env.E2E_SUPABASE_KEY;
test.skip(
  !url || !key,
  "needs a throwaway local Supabase stack, which sets E2E_SUPABASE_URL and E2E_SUPABASE_KEY",
);

/** Signs a fresh account up into [context], and returns its id and a client signed in as it. */
async function signUp(context: BrowserContext, baseURL: string, name: string) {
  if (!url || !key) throw new Error("skipped without local stack");
  const jar = new Map<string, string>();
  const auth = createServerClient(url, key, {
    cookies: {
      getAll: () => [...jar].map(([cookie, value]) => ({ name: cookie, value })),
      setAll: (cookies) => {
        for (const { name: cookie, value } of cookies) jar.set(cookie, value);
      },
    },
  });
  const email = `web-home-${name}-${randomUUID()}@example.com`;
  const password = "web-home-test-password";
  const signup = await auth.auth.signUp({ email, password });
  expect(signup.error).toBeNull();
  const userId = signup.data.user?.id;
  if (!userId) throw new Error("sign-up returned no fixture user");
  await context.addCookies(
    [...jar].map(([cookie, value]) => ({ name: cookie, value, url: baseURL })),
  );
  const db = createClient(url, key, { auth: { persistSession: false } });
  await db.auth.signInWithPassword({ email, password });
  return { userId, db };
}

const text = (id: string, value: string) => ({ type: "text", v: 1, id, payload: { text: value } });

// Where to save screenshots of the screens; none are taken unless it names a directory.
async function capture(page: Page, name: string) {
  const directory = process.env.E2E_SCREENSHOTS;
  await page.addStyleTag({
    content: "*, *::before, *::after { transition: none !important; animation: none !important; }",
  });
  for (const [width, height] of [
    [390, 844],
    [1280, 900],
  ] as const) {
    await page.setViewportSize({ width, height });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      if (directory)
        await page.screenshot({
          path: `${directory}/${colorScheme}/web-${name}-${String(width)}.png`,
          fullPage: true,
        });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
}

test("draws the first-run home, the home, a note, its 카드 추가 sheet and 새 노트", async ({
  page,
  context,
  baseURL,
  browser,
}) => {
  if (!baseURL) throw new Error("skipped without local stack");

  const fresh = await browser.newContext({ baseURL });
  await signUp(fresh, baseURL, "first");
  const first = await fresh.newPage();
  await first.goto("/");
  await expect(first.getByRole("heading", { name: "첫 노트를 만들어 볼까요?" })).toBeVisible();
  await capture(first, "first-run");
  await fresh.close();

  const { userId, db } = await signUp(context, baseURL, "home");
  const time = new Date(Date.now() - 86_400_000).toISOString();
  const decks = [
    { id: randomUUID(), name: "영단어 기본", words: ["ephemeral", "meticulous", "resilient"] },
    { id: randomUUID(), name: "일본어 N3 한자", words: ["約束", "準備"] },
  ];
  for (const deck of decks) {
    const inserted = await db.from("decks").insert({
      id: deck.id,
      user_id: userId,
      name: deck.name,
      visibility: "private",
      created_at: time,
      updated_at: time,
    });
    expect(inserted.error).toBeNull();
    const cards = await db.from("cards").insert(
      deck.words.map((word, at) => ({
        id: randomUUID(),
        deck_id: deck.id,
        user_id: userId,
        front: [text(`f${String(at)}`, word)],
        back: [text(`b${String(at)}`, `${word}의 뜻`)],
        card_key: word,
        source: "manual",
        template: "free",
        template_version: 2,
        created_at: time,
        updated_at: time,
      })),
    );
    expect(cards.error).toBeNull();
  }

  await page.goto("/");
  await expect(page.getByText("영단어 기본").first()).toBeVisible();
  await capture(page, "home");

  await page.goto("/decks");
  await expect(page.getByText("영단어 기본").first()).toBeVisible();
  await capture(page, "decks");

  await page.goto(`/decks/${decks[0]?.id ?? ""}`);
  await expect(page.getByRole("heading", { name: "영단어 기본" })).toBeVisible();
  await capture(page, "note");

  await expect(async () => {
    await page.getByRole("button", { name: "카드 추가", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 2_000 });
  }).toPass();
  await capture(page, "add-sheet");

  await page.goto("/decks");
  await expect(async () => {
    await page.getByRole("button", { name: "새 노트 만들기", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 2_000 });
  }).toPass();
  await page.getByRole("button", { name: "직접 입력" }).click();
  await expect(page.getByRole("dialog", { name: "새 노트" })).toBeVisible();
  await capture(page, "new-note");
});
