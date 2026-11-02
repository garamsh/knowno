import { randomUUID } from "node:crypto";

import { type BrowserContext, expect, type Locator, type Page, test } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

import { expectScreenAtWidths } from "./authoring-screen";
import { untilReacted } from "./until-reacted";

// The local stack scripts/test-web.ts starts, whose URL and publishable key the app was built with.
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

/**
 * Checks that [control] sits on its 7 px button edge in the colour of the token [token], at 390
 * and 1280 px in both themes, as the phone's `AppButton` draws its variant's edge. It leaves the
 * page at 390 px in the light theme.
 */
async function expectEdge(page: Page, control: Locator, token: string) {
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      const { edge, colour } = await control.evaluate((element, name) => {
        const probe = document.createElement("span");
        probe.style.color = `var(${name})`;
        document.body.append(probe);
        const resolved = getComputedStyle(probe).color;
        probe.remove();
        return { edge: getComputedStyle(element).boxShadow, colour: resolved };
      }, token);
      expect(edge, `${token} at ${String(width)} in ${colorScheme}`).toBe(`${colour} 0px 7px 0px 0px`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
}

/** The height [field] is drawn at, in px. */
async function fieldHeight(field: Locator): Promise<number> {
  const box = await field.boundingBox();
  if (!box) throw new Error("the field is drawn");
  return box.height;
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
  const firstUser = await signUp(fresh, baseURL, "first");
  const first = await fresh.newPage();
  await first.goto("/");
  await expect(first.getByRole("heading", { name: "첫 노트를 만들어 볼까요?" })).toBeVisible();
  await capture(first, "first-run");
  // With a note and no card, 홈's hero leads to adding one on the hero button's own edge.
  const empty = await firstUser.db.from("decks").insert({
    id: randomUUID(),
    user_id: firstUser.userId,
    name: "빈 노트",
    color: "blue",
    visibility: "private",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  expect(empty.error).toBeNull();
  await first.goto("/");
  await expect(first.getByRole("heading", { name: "첫 카드를 만들어 볼까요?" })).toBeVisible();
  await expectEdge(first, first.getByRole("link", { name: "카드 추가", exact: true }), "--color-on-hero-edge");
  await capture(first, "no-cards");
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
  await expectEdge(page, page.getByRole("link", { name: "시작", exact: true }), "--color-on-hero-edge");
  await capture(page, "home");
  await untilReacted(
    () => page.getByRole("button", { name: "노트 검색", exact: true }).click(),
    () => page.getByRole("searchbox", { name: "노트 검색" }).isVisible(),
  );
  await page.getByRole("searchbox", { name: "노트 검색" }).fill("한");
  // Control for the fields below: a search over a list is the phone's search height.
  expect(await fieldHeight(page.getByRole("searchbox", { name: "노트 검색" }))).toBe(46);
  await capture(page, "drawer-search");

  await page.goto(`/decks/${decks[0]?.id ?? ""}`);
  await expect(page.getByRole("heading", { level: 1, name: "영단어 기본" })).toBeVisible();
  // Control: off the hero, the study link is the primary fill on the primary's edge.
  await expectEdge(
    page,
    page.getByRole("link", { name: /^이 노트 학습/ }),
    "--color-primary-edge",
  );
  await capture(page, "note");

  await untilReacted(
    () => page.getByRole("button", { name: "카드 추가", exact: true }).click(),
    () => page.getByRole("dialog", { name: "카드 추가" }).isVisible(),
  );
  await capture(page, "add-sheet");
  await page.getByRole("button", { name: "직접 입력", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "새 카드" });
  await expect(editor).toBeVisible();
  await expectScreenAtWidths(page, editor);
  // Each text field is the phone's AppTextField height, as are the ones below.
  expect(await fieldHeight(editor.getByRole("textbox", { name: "앞면", exact: true }))).toBe(50);
  await capture(page, "new-card");
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
  expect(await fieldHeight(note.getByRole("textbox", { name: "이름", exact: true }))).toBe(50);
  for (const label of ["저장", "저장하고 카드 추가"]) {
    expect(await labelLines(note.getByRole("button", { name: label, exact: true })), label).toBe(1);
  }
  await expectScreenAtWidths(page, note);
  await capture(page, "new-note");
  // 저장하고 카드 추가 opens the new note with its 카드 추가 sheet up, its colour stored.
  // The radio is visually hidden inside its swatch, which takes the pointer.
  await note.getByRole("radio", { name: "모래" }).check({ force: true });
  await note.getByRole("button", { name: "저장하고 카드 추가", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "카드 추가" })).toBeVisible();
  const stored = await db.from("decks").select("name,color").eq("name", "토익 900");
  expect(stored.data).toEqual([{ name: "토익 900", color: "sand" }]);
});

test("answers the browser's back on an authoring screen as the phone's back, and leaves 새 노트 for its note", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("skipped without local stack");
  const { userId, db } = await signUp(context, baseURL, "back");
  const deckId = randomUUID();
  const time = new Date().toISOString();
  const inserted = await db.from("decks").insert({
    id: deckId,
    user_id: userId,
    name: "단어장",
    visibility: "private",
    created_at: time,
    updated_at: time,
  });
  expect(inserted.error).toBeNull();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.goto(`/decks/${deckId}`);
  const editor = page.getByRole("dialog", { name: "새 카드" });
  const question = page.getByRole("dialog", { name: "작성 중인 카드를 버릴까요?" });
  const openEditor = async () => {
    await untilReacted(
      () => page.getByRole("button", { name: "카드 추가", exact: true }).click(),
      () => page.getByRole("dialog", { name: "카드 추가" }).isVisible(),
    );
    await page.getByRole("button", { name: "직접 입력", exact: true }).click();
    await expect(editor).toBeVisible();
  };

  // Untouched, the back closes the screen and stays on the note, focus back on 카드 추가.
  await openEditor();
  await page.goBack();
  await expect(editor).toBeHidden();
  expect(new URL(page.url()).pathname).toBe(`/decks/${deckId}`);
  await expect(page.getByRole("button", { name: "카드 추가", exact: true })).toBeFocused();

  // Over the screen, the back closes a sheet alone; the next asks about the 칸 added, and 버리기
  // leaves nothing behind.
  const addSheet = page.getByRole("dialog", { name: "칸 추가" });
  await openEditor();
  await editor.getByRole("button", { name: "+ 칸 추가", exact: true }).click();
  await addSheet.getByRole("button", { name: "단어", exact: true }).click();
  await editor.getByRole("button", { name: "+ 칸 추가", exact: true }).click();
  await expect(addSheet).toBeVisible();
  await page.goBack();
  await expect(addSheet).toBeHidden();
  await expect(editor).toBeVisible();
  await page.goBack();
  await question.getByRole("button", { name: "버리기", exact: true }).click();
  await expect(editor).toBeHidden();
  await page.goBack();
  await expect(page).toHaveURL(`${baseURL}/`);
  await page.goForward();
  await expect(page.getByRole("heading", { level: 1, name: "단어장" })).toBeVisible();

  // Holding a change, the back asks first; a back on the question keeps writing, and so does
  // Escape on the question; Escape on the screen asks too, and 버리기 leaves.
  await openEditor();
  await editor.getByRole("textbox", { name: "앞면", exact: true }).fill("사과");
  await page.goBack();
  await expect(question).toBeVisible();
  await page.goBack();
  await expect(question).toBeHidden();
  await expect(editor.getByRole("textbox", { name: "앞면", exact: true })).toHaveValue("사과");
  await page.goBack();
  await expect(question).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(question).toBeHidden();
  await page.keyboard.press("Escape");
  await question.getByRole("button", { name: "버리기", exact: true }).click();
  await expect(editor).toBeHidden();
  expect(new URL(page.url()).pathname).toBe(`/decks/${deckId}`);

  // Every entry the screens held is gone, so the next back leaves the note for 홈.
  await page.goBack();
  await expect(page).toHaveURL(`${baseURL}/`);

  // 새 노트 is left before its note opens, so a back from that note returns to 홈.
  await untilReacted(
    () => page.getByRole("button", { name: "새 노트", exact: true }).click(),
    () => page.getByRole("dialog", { name: "새 노트" }).isVisible(),
  );
  await page.getByRole("textbox", { name: "이름", exact: true }).fill("토익");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "토익" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(`${baseURL}/`);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
