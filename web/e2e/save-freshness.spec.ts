import { randomUUID } from "node:crypto";

import { type BrowserContext, expect, type Locator, type Page, test } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

import { addByHand } from "./add-by-hand";
import { untilReacted } from "./until-reacted";

// The local stack scripts/test-web.ts starts, whose URL and publishable key the app was built with.
const url = process.env.E2E_SUPABASE_URL;
const key = process.env.E2E_SUPABASE_KEY;
test.skip(
  !url || !key,
  "needs a throwaway local Supabase stack, which sets E2E_SUPABASE_URL and E2E_SUPABASE_KEY",
);

/**
 * Signs up a fresh user, hands the browser its session, and returns a client acting as it beside
 * its id.
 */
async function signUp(context: BrowserContext, baseURL: string) {
  if (!url || !key) throw new Error("skipped without local stack");
  const jar = new Map<string, string>();
  const auth = createServerClient(url, key, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) jar.set(name, value);
      },
    },
  });
  const email = `web-save-freshness-${randomUUID()}@example.com`;
  const password = "web-save-freshness-test-password";
  const signup = await auth.auth.signUp({ email, password });
  expect(signup.error).toBeNull();
  const userId = signup.data.user?.id;
  if (!userId) throw new Error("sign-up returned no fixture user");
  await context.addCookies([...jar].map(([name, value]) => ({ name, value, url: baseURL })));
  const db = createClient(url, key, { auth: { persistSession: false } });
  await db.auth.signInWithPassword({ email, password });
  return { db, userId };
}

/** Follows the tab bar's [name] link until [arrived] shows, a click before hydration doing nothing. */
async function tab(page: Page, name: "홈" | "노트", arrived: Locator) {
  await untilReacted(
    () =>
      page
        .getByRole("navigation", { name: "주 메뉴" })
        .last()
        .getByRole("link", { name, exact: true })
        .click(),
    () => arrived.isVisible(),
  );
}

/** Opens 노트 설정 and picks [item], once the page has hydrated enough to open the menu. */
async function choose(page: Page, item: string) {
  await untilReacted(
    () => page.getByRole("button", { name: "노트 설정" }).click(),
    () => page.getByRole("menu", { name: "노트 설정" }).isVisible(),
  );
  await page.getByRole("menuitem", { name: item, exact: true }).click();
}

const text = (id: string, value: string) => ({ type: "text", v: 1, id, payload: { text: value } });

/**
 * A fresh user's notes "Kept" and, given [fresh], "Fresh" holding [cards] cards; then 홈 and the
 * 노트 page visited in the browser, so its router holds both before any save.
 */
async function seeded(
  page: Page,
  context: BrowserContext,
  baseURL: string,
  fresh?: { cards: number },
) {
  const { db, userId } = await signUp(context, baseURL);
  const time = new Date(Date.now() - 86_400_000).toISOString();
  const freshId = randomUUID();
  const decks = await db.from("decks").insert(
    [{ id: randomUUID(), name: "Kept" }, ...(fresh ? [{ id: freshId, name: "Fresh" }] : [])].map(
      (deck) => ({
        ...deck,
        user_id: userId,
        visibility: "private",
        created_at: time,
        updated_at: time,
      }),
    ),
  );
  expect(decks.error).toBeNull();
  for (let at = 0; at < (fresh?.cards ?? 0); at++) {
    const card = await db.from("cards").insert({
      id: randomUUID(),
      deck_id: freshId,
      user_id: userId,
      front: [text(`f${String(at)}`, `word ${String(at)}`)],
      back: [text(`b${String(at)}`, "뜻")],
      card_key: `word ${String(at)}`,
      source: "manual",
      template: "free",
      template_version: 2,
      created_at: time,
      updated_at: time,
    });
    expect(card.error).toBeNull();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const notes = page.getByRole("heading", { level: 1, name: "노트", exact: true });
  const row = (name: RegExp) =>
    page.getByRole("region", { name: "노트 목록" }).getByRole("link", { name });
  const noCard = page.getByRole("heading", { name: "첫 카드를 만들어 볼까요?" });
  const start = page.getByRole("link", { name: "시작", exact: true });
  await page.goto("/");
  await expect(fresh?.cards ? start : noCard).toBeVisible();
  await tab(page, "노트", notes);
  await expect(row(/^Kept, /)).toBeVisible();
  return { notes, row, noCard, start };
}

// Each test visits 홈 and the 노트 page before a save and reaches them after it by the tab bar and
// the browser's back, which the client router serves from what it holds, so a route a save leaves
// unrefreshed shows its earlier data there (#603, #614). A page.goto loads afresh and would not.

test("shows a note 새 노트 makes on the 노트 page a back returns to", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("skipped without local stack");
  const { notes, row } = await seeded(page, context, baseURL);
  await addByHand(page, "노트 메뉴");
  await page.getByRole("textbox", { name: "노트 이름", exact: true }).fill("Fresh");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  const fresh = page.getByRole("heading", { level: 1, name: "Fresh", exact: true });
  await expect(fresh).toBeVisible();
  await page.goBack();
  await expect(notes).toBeVisible();
  await expect(row(/^Fresh, 카드 0장/)).toBeVisible();
  await page.goForward();
  await expect(fresh).toBeVisible();
});

test("shows a card added and edited on the note, the 노트 page and 홈, and on the note after a back", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("skipped without local stack");
  const { notes, row, noCard, start } = await seeded(page, context, baseURL, { cards: 0 });
  const fresh = page.getByRole("heading", { level: 1, name: "Fresh", exact: true });
  await row(/^Fresh, /).click();
  await expect(fresh).toBeVisible();

  // A card added stays on the note, which lists it; the 노트 page counts it and 홈 offers 시작.
  await addByHand(page);
  await page.getByRole("button", { name: "직접 입력", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "새 카드" });
  await editor.getByRole("textbox", { name: "앞면", exact: true }).fill("apple");
  await editor.getByRole("textbox", { name: "뒷면", exact: true }).fill("사과");
  await editor.getByRole("button", { name: "저장", exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByRole("button", { name: /^apple/ })).toBeVisible();
  await tab(page, "노트", notes);
  await expect(row(/^Fresh, 카드 1장/)).toBeVisible();
  await tab(page, "홈", start);
  await expect(noCard).toHaveCount(0);
  await page.goBack();
  await expect(row(/^Fresh, 카드 1장/)).toBeVisible();
  await page.goBack();
  await expect(fresh).toBeVisible();
  await expect(page.getByRole("button", { name: /^apple/ })).toBeVisible();

  // A card edited shows its new front on the note, and again after a back to it.
  await untilReacted(
    () => page.getByRole("button", { name: /^apple/ }).click(),
    () => page.getByRole("dialog", { name: "카드 편집" }).isVisible(),
  );
  const edit = page.getByRole("dialog", { name: "카드 편집" });
  await edit.getByRole("textbox", { name: "앞면", exact: true }).fill("banana");
  await edit.getByRole("button", { name: "저장", exact: true }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByRole("button", { name: /^banana/ })).toBeVisible();
  await tab(page, "노트", notes);
  await page.goBack();
  await expect(fresh).toBeVisible();
  await expect(page.getByRole("button", { name: /^banana/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^apple/ })).toHaveCount(0);
});

test("shows a rename on the note, the 노트 page and a back to the note, and a delete on the 노트 page and 홈", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("skipped without local stack");
  const { notes, row, noCard, start } = await seeded(page, context, baseURL, { cards: 1 });
  await row(/^Fresh, /).click();
  await expect(page.getByRole("heading", { level: 1, name: "Fresh", exact: true })).toBeVisible();

  // A rename heads the note at once, and the 노트 page and a back to the note hold it.
  await choose(page, "이름 바꾸기");
  const rename = page.getByRole("dialog", { name: "노트 이름 바꾸기" });
  await rename.getByRole("textbox", { name: "노트 이름" }).fill("Renamed");
  await rename.getByRole("button", { name: "저장", exact: true }).click();
  const renamed = page.getByRole("heading", { level: 1, name: "Renamed", exact: true });
  await expect(renamed).toBeVisible();
  await tab(page, "노트", notes);
  await expect(row(/^Renamed, 카드 1장/)).toBeVisible();
  await expect(row(/^Fresh, /)).toHaveCount(0);
  await page.goBack();
  await expect(renamed).toBeVisible();

  // A delete opens the 노트 page without the note, and 홈, its one card gone, offers no 시작.
  await choose(page, "노트 삭제");
  await page
    .getByRole("dialog", { name: '"Renamed" 노트를 삭제할까요?' })
    .getByRole("button", { name: "삭제", exact: true })
    .click();
  await expect(page).toHaveURL(`${baseURL}/decks`);
  await expect(row(/^Kept, /)).toBeVisible();
  await expect(row(/^Renamed, /)).toHaveCount(0);
  await tab(page, "홈", noCard);
  await expect(start).toHaveCount(0);
});
