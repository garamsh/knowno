import { randomUUID } from "node:crypto";

import { type BrowserContext, expect, type Locator, type Page, test } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

import { untilReacted } from "./until-reacted";

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

/**
 * Saves [page] at 390 and 1280 px in both themes, when E2E_SCREENSHOTS names a directory, and,
 * at 390 px shown at 200% (a 195 px viewport at twice the pixels), under its `200` folder; at
 * every size no page scrolls sideways and no text is cut by its box (`clipped`).
 */
async function capture(page: Page, name: string) {
  const directory = process.env.E2E_SCREENSHOTS;
  await page.addStyleTag({
    content: "*, *::before, *::after { transition: none !important; animation: none !important; }",
  });
  for (const [width, height, zoom] of [
    [390, 844, 1],
    [1280, 900, 1],
    [195, 422, 2],
  ] as const) {
    await page.setViewportSize({ width, height });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      // What reaches past the viewport's right edge, named by its tag and classes.
      expect(
        await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>("body *")]
            .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 0.5)
            .map((element) => `${element.tagName} ${element.className}`),
        ),
        `${name} at ${String(width)} scrolls sideways`,
      ).toEqual([]);
      expect(await clipped(page), `${name} at ${String(width)}`).toEqual([]);
      if (directory)
        await page.screenshot({
          path:
            zoom === 1
              ? `${directory}/${colorScheme}/web-${name}-${String(width)}.png`
              : `${directory}/200/${colorScheme}/web-${name}-390.png`,
          fullPage: true,
          scale: "css",
        });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
}

/**
 * The text of each element on the page whose own text overflows its box sideways or downwards
 * where its box hides what overflows. A row's `truncate`, which ends a user's long name in an
 * ellipsis by design, is left out.
 */
function clipped(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => {
        const own = [...element.childNodes].some(
          (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "",
        );
        if (!own || element.closest(".sr-only, .truncate") || element.offsetParent === null)
          return false;
        const style = getComputedStyle(element);
        const hides = (value: string) => value === "hidden" || value === "clip";
        return (
          (hides(style.overflowX) && element.scrollWidth > element.clientWidth + 1) ||
          (hides(style.overflowY) && element.scrollHeight > element.clientHeight + 1)
        );
      })
      .map((element) => element.textContent.trim()),
  );
}

/** How many lines [button]'s label takes. */
function labelLines(button: Locator): Promise<number> {
  return button.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
  });
}

test("draws the first-run home, 홈 and its drawer, a note, its 카드 추가 sheet and 새 노트, a pair of buttons on one line", async ({
  page,
  context,
  baseURL,
  browser,
}) => {
  if (!baseURL) throw new Error("skipped without local stack");
  // Seven screens at three sizes in two themes each.
  test.setTimeout(120_000);

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
    { id: randomUUID(), name: "영단어 기본", color: "blue", words: ["ephemeral", "meticulous"] },
    { id: randomUUID(), name: "일본어 N3 한자", color: "violet", words: ["約束", "準備"] },
    { id: randomUUID(), name: "한국사 연표", color: "amber", words: ["고려"] },
  ];
  for (const deck of decks) {
    const inserted = await db.from("decks").insert({
      id: deck.id,
      user_id: userId,
      name: deck.name,
      color: deck.color,
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
  await expect(page.getByRole("heading", { name: "오늘 5장", exact: true })).toBeVisible();
  // At a phone's width the drawer starts below the hero, its first row above the tab bar and the
  // next under it, pulled up by the page's scroll.
  await page.setViewportSize({ width: 390, height: 844 });
  const tabBar = await page.getByRole("navigation", { name: "주 메뉴" }).last().boundingBox();
  const rows = page.getByRole("region", { name: /^내 노트/ }).getByRole("link");
  await expect(rows).toHaveCount(3);
  const firstRow = await rows.nth(0).boundingBox();
  const secondRow = await rows.nth(1).boundingBox();
  if (!tabBar || !firstRow || !secondRow) throw new Error("the tab bar and the rows are drawn");
  expect(firstRow.y + firstRow.height).toBeLessThanOrEqual(tabBar.y);
  expect(secondRow.y).toBeGreaterThanOrEqual(tabBar.y);
  await capture(page, "home");
  await untilReacted(
    () => page.getByRole("button", { name: "노트 검색", exact: true }).click(),
    () => page.getByRole("searchbox", { name: "노트 검색" }).isVisible(),
  );
  await page.getByRole("searchbox", { name: "노트 검색" }).fill("한");
  await capture(page, "drawer-search");

  await page.goto(`/decks/${decks[0]?.id ?? ""}`);
  await expect(page.getByRole("heading", { level: 1, name: "영단어 기본" })).toBeVisible();
  await capture(page, "note");

  await untilReacted(
    () => page.getByRole("button", { name: "카드 추가", exact: true }).click(),
    () => page.getByRole("dialog", { name: "카드 추가" }).isVisible(),
  );
  await capture(page, "add-sheet");
  await page.getByRole("button", { name: "직접 입력", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "새 카드" });
  await expect(editor).toBeVisible();
  // At 100% on a phone, each of the pair's labels takes one line.
  for (const label of ["저장", "저장하고 다음 카드"]) {
    expect(await labelLines(editor.getByRole("button", { name: label, exact: true })), label).toBe(
      1,
    );
  }

  await page.goto("/");
  await untilReacted(
    () => page.getByRole("button", { name: "새 노트", exact: true }).click(),
    () => page.getByRole("dialog", { name: "새 노트" }).isVisible(),
  );
  const note = page.getByRole("dialog", { name: "새 노트" });
  await note.getByRole("textbox", { name: "이름", exact: true }).fill("토익 900");
  for (const label of ["저장", "저장하고 카드 추가"]) {
    expect(await labelLines(note.getByRole("button", { name: label, exact: true })), label).toBe(1);
  }
  await capture(page, "new-note");
  // 저장하고 카드 추가 opens the new note with its 카드 추가 sheet up, its colour stored.
  // The radio is visually hidden inside its swatch, which takes the pointer.
  await note.getByRole("radio", { name: "모래" }).check({ force: true });
  await note.getByRole("button", { name: "저장하고 카드 추가", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "카드 추가" })).toBeVisible();
  const stored = await db.from("decks").select("name,color").eq("name", "토익 900");
  expect(stored.data).toEqual([{ name: "토익 900", color: "sand" }]);
});
