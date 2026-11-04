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

/** A one-pixel PNG, the photo 새 노트 picks. */
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);

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
      expect(edge, `${token} at ${String(width)} in ${colorScheme}`).toBe(
        `${colour} 0px 7px 0px 0px`,
      );
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

/** The names of [boxes] that read as not drawn, for a guard to say which were missing. */
function undrawn(boxes: Record<string, unknown>): string {
  return Object.entries(boxes)
    .flatMap(([name, box]) => (box ? [] : [name]))
    .join(", ");
}

/**
 * Waits until the [mascot] is the drawing it keeps at its size. The server draws it still; on
 * screen from 128 px across, the client puts its moving drawing in the still one's place (ADR 0152,
 * ADR 0193), and a box read across that swap finds no element.
 */
async function untilMascotSettled(mascot: Locator): Promise<void> {
  await expect
    .poll(() =>
      mascot.evaluate(
        (element) => element.tagName === "svg" || element.getBoundingClientRect().width < 128,
      ),
    )
    .toBe(true);
}

/** How many lines [button]'s label takes. */
function labelLines(button: Locator): Promise<number> {
  return button.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
  });
}

test("draws the first-run home, 홈 with its streak, the 노트 page, a note, its 카드 추가 sheet and 새 노트, a pair of buttons on one line", async ({
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
  // With a note and no card, 홈 leads to adding one, its primary on the primary's edge.
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
  await expectEdge(
    first,
    first.getByRole("link", { name: "카드 추가", exact: true }),
    "--color-primary-edge",
  );
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
  // At a phone's width 홈 holds no note: the streak above the tab bar, on the one screen.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("region", { name: "노트 목록" })).toHaveCount(0);
  const [tabBar, week] = await Promise.all([
    page.getByRole("navigation", { name: "주 메뉴" }).last().boundingBox(),
    page.getByRole("region", { name: "0일 연속" }).boundingBox(),
  ]);
  if (!tabBar || !week) throw new Error("the tab bar and the streak are drawn");
  expect(week.y + week.height).toBeLessThan(tabBar.y);
  await expectEdge(
    page,
    page.getByRole("link", { name: "시작", exact: true }),
    "--color-primary-edge",
  );
  await capture(page, "home");
  // 노트 from the tab bar: every note under the 노트 검색 field, open from the first.
  await untilReacted(
    () =>
      page
        .getByRole("navigation", { name: "주 메뉴" })
        .last()
        .getByRole("link", { name: "노트" })
        .click(),
    async () => (await page.getByRole("heading", { level: 1, name: "노트" }).count()) > 0,
  );
  await expect(page.getByRole("region", { name: "노트 목록" }).getByRole("link")).toHaveCount(3);
  await page.getByRole("searchbox", { name: "노트 검색" }).fill("한");
  // Control for the fields below: a search over a list is the phone's search height, the box
  // drawn round the field and its magnifier.
  expect(
    await fieldHeight(page.getByRole("searchbox", { name: "노트 검색" }).locator("xpath=..")),
  ).toBe(48);
  await capture(page, "notes-search");

  await page.goto(`/decks/${decks[0]?.id ?? ""}`);
  await expect(page.getByRole("heading", { level: 1, name: "영단어 기본" })).toBeVisible();
  // Control: off the hero, the study link is the primary fill on the primary's edge.
  await expectEdge(page, page.getByRole("link", { name: /^이 노트 학습/ }), "--color-primary-edge");
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

  await page.goto("/decks");
  await untilReacted(
    () => page.getByRole("button", { name: "새 노트", exact: true }).click(),
    () => page.getByRole("dialog", { name: "새 노트" }).isVisible(),
  );
  const note = page.getByRole("dialog", { name: "새 노트" });
  // The name field opens focused, as the phone's.
  await expect(note.getByRole("textbox", { name: "노트 이름", exact: true })).toBeFocused();
  await note.getByRole("textbox", { name: "노트 이름", exact: true }).fill("토익 900");
  expect(await fieldHeight(note.getByRole("textbox", { name: "노트 이름", exact: true }))).toBe(50);
  for (const label of ["저장", "저장하고 카드 추가"]) {
    expect(await labelLines(note.getByRole("button", { name: label, exact: true })), label).toBe(1);
  }
  await expectScreenAtWidths(page, note);
  // The radio is visually hidden inside its swatch, which takes the pointer.
  await note.getByRole("radio", { name: "모래" }).check({ force: true });
  await capture(page, "new-note");
  // A photo folds the icon and the colour, and the note is made with it.
  await note
    .getByLabel("앨범에서 고르기")
    .setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: png });
  await expect(note.getByRole("button", { name: "사진 삭제", exact: true })).toBeVisible();
  await expect(note.getByRole("group", { name: "색" })).toHaveCount(0);
  await capture(page, "new-note-photo");
  // 저장하고 카드 추가 opens the new note with its 카드 추가 sheet up, its colour and photo stored.
  await note.getByRole("button", { name: "저장하고 카드 추가", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "카드 추가" })).toBeVisible();
  const stored = await db.from("decks").select("name,color,image_media_id").eq("name", "토익 900");
  expect(stored.data).toEqual([
    { name: "토익 900", color: "sand", image_media_id: expect.any(String) as unknown },
  ]);
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

  // 새 노트 is left before its note opens, so a back from that note returns to the 노트 page.
  await page.goto("/decks");
  await untilReacted(
    () => page.getByRole("button", { name: "새 노트", exact: true }).click(),
    () => page.getByRole("dialog", { name: "새 노트" }).isVisible(),
  );
  await page.getByRole("textbox", { name: "노트 이름", exact: true }).fill("토익");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "토익" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(`${baseURL}/decks`);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

/** The `theme-color` the browser's bar takes on [page]: the first one in its head. */
function themeColor(page: Page): Promise<string | null> {
  return page.evaluate(
    () => document.head.querySelector('meta[name="theme-color"]')?.getAttribute("content") ?? null,
  );
}

test("draws 홈 as one screen with the owner's 481 cards over four notes on a 19-day streak: the sky from the top over the ground, the mascot at 140 on the hill, the streak and 시작 whole on its edge above the tab bar, with nothing to scroll", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("skipped without local stack");
  test.setTimeout(120_000);
  // The owner's case on #610 and #611: 481 cards due today over four notes, studied on each of
  // the 19 days before.
  const { userId, db } = await signUp(context, baseURL, "fit");
  const day = 86_400_000;
  const time = new Date(Date.now() - 30 * day).toISOString();
  const decks = ["영단어 기본", "토익 빈출", "일본어 N3", "회화 표현"].map((name) => ({
    id: randomUUID(),
    user_id: userId,
    name,
    visibility: "private",
    created_at: time,
    updated_at: time,
  }));
  expect((await db.from("decks").insert(decks)).error).toBeNull();
  const cards = Array.from({ length: 481 }, (_, at) => ({
    id: randomUUID(),
    deck_id: decks[at % decks.length]?.id,
    user_id: userId,
    front: [text("f", `word ${String(at)}`)],
    back: [text("b", `뜻 ${String(at)}`)],
    card_key: `word ${String(at)}`,
    source: "manual",
    template: "free",
    template_version: 2,
    created_at: time,
    updated_at: time,
  }));
  expect((await db.from("cards").insert(cards)).error).toBeNull();
  // Due an hour ago after a day's interval: today's reviews, a day's load, so not a backlog.
  const states = await db.from("card_states").insert(
    cards.map((card) => ({
      user_id: userId,
      card_id: card.id,
      stability: 1,
      difficulty: 5,
      last_review: new Date(Date.now() - day).toISOString(),
      due: new Date(Date.now() - 3_600_000).toISOString(),
      updated_at: time,
    })),
  );
  expect(states.error).toBeNull();
  // The last six days' cards as the phone's shots count them, ten a day before.
  const recent = [38, 52, 23, 41, 66, 47];
  const reviews = Array.from({ length: 19 }, (_, back) => {
    const daysAgo = back + 1;
    const count = recent[recent.length - daysAgo] ?? 10;
    return cards.slice(0, count).map((card) => ({
      id: randomUUID(),
      card_id: card.id,
      user_id: userId,
      rating: "good",
      reviewed_at: new Date(Date.now() - daysAgo * day).toISOString(),
      duration_ms: 3000,
      updated_at: time,
    }));
  }).flat();
  expect((await db.from("reviews").insert(reviews)).error).toBeNull();

  await page.goto("/");
  const sky = page.getByRole("region", { name: "오늘 481장" });
  await expect(sky.getByRole("heading", { name: "오늘 481장", exact: true })).toBeVisible();
  const week = page.getByRole("region", { name: "19일 연속" });
  await expect(week.getByRole("img")).toBeVisible();
  const start = page.getByRole("link", { name: "시작", exact: true });
  const mascot = sky.locator('img[src*="/brand/knowno-"], svg.mascot').first();
  await untilMascotSettled(mascot);
  // At 140 the thinking mascot breathes as well as blinks.
  await expect.soft(mascot).toHaveAttribute("data-motion", "full");
  // The page covers the screen, so the sky runs up behind the status bar.
  expect(
    await page.evaluate(
      () => document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? "",
    ),
  ).toContain("viewport-fit=cover");
  const directory = process.env.E2E_SCREENSHOTS;
  for (const [width, height] of [
    [390, 844],
    [375, 667],
    [430, 932],
  ] as const) {
    await page.setViewportSize({ width, height });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      const at = `at ${String(width)} × ${String(height)} in ${colorScheme}`;
      if (directory)
        await page.screenshot({
          path: `${directory}/${colorScheme}/web-home-owner-${String(height)}.png`,
        });
      const [panel, button, drawn, streak, tabBar] = await Promise.all([
        sky.boundingBox(),
        start.boundingBox(),
        mascot.boundingBox(),
        week.boundingBox(),
        page.getByRole("navigation", { name: "주 메뉴" }).last().boundingBox(),
      ]);
      if (!panel || !button || !drawn || !streak || !tabBar)
        throw new Error(
          `홈 is drawn ${at}, but not: ${undrawn({ sky: panel, 시작: button, mascot: drawn, "the streak": streak, "the tab bar": tabBar })}`,
        );
      // One screen: nothing to scroll; the sky from the top, about 58% of the screen; the
      // mascot at 140 under the sky's words and over the streak, which is over 시작, whose edge
      // is whole above the tab bar. Each size is checked, and shot, whatever an earlier one found.
      expect
        .soft(
          await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight),
          at,
        )
        .toBeLessThanOrEqual(0);
      expect.soft(panel.y, at).toBe(0);
      expect.soft(Math.abs(panel.height - 0.58 * height), at).toBeLessThanOrEqual(80);
      expect.soft(drawn.height, at).toBe(140);
      expect.soft(drawn.width, at).toBe(140);
      expect.soft(drawn.y + drawn.height, at).toBeLessThanOrEqual(streak.y);
      expect.soft(streak.y + streak.height, at).toBeLessThanOrEqual(button.y);
      expect.soft(button.y + button.height + 7, at).toBeLessThanOrEqual(tabBar.y);
      expect.soft(await clipped(page), at).toEqual([]);
    }
  }
  // From 1024 px the same screen in the content column, beside the side menu, with nothing to
  // scroll.
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    if (directory)
      await page.screenshot({ path: `${directory}/${colorScheme}/web-home-owner-1280.png` });
  }
  const [panel, button, column] = await Promise.all([
    sky.boundingBox(),
    start.boundingBox(),
    page.locator("main").boundingBox(),
  ]);
  if (!panel || !button || !column)
    throw new Error(
      `홈 is drawn at 1280, but not: ${undrawn({ sky: panel, 시작: button, column })}`,
    );
  expect(panel.x).toBeGreaterThanOrEqual(column.x);
  expect(button.y + button.height).toBeLessThanOrEqual(800);
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight),
  ).toBeLessThanOrEqual(0);
  // Shown at 200% on a phone (a 195 px viewport at twice the pixels), the words cannot fit:
  // the page scrolls, nothing is cut, and 시작 is reached whole.
  await page.setViewportSize({ width: 195, height: 422 });
  await page.emulateMedia({ colorScheme: "light" });
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight),
  ).toBeGreaterThan(0);
  expect(await clipped(page)).toEqual([]);
  await start.scrollIntoViewIfNeeded();
  const reached = await start.boundingBox();
  expect(reached && reached.y + reached.height).toBeLessThanOrEqual(422);
  if (directory) await page.screenshot({ path: `${directory}/200/light/web-home-owner-390.png` });
});

test("draws 홈 with the day done and in a backlog at 390 and 1280 px and at 200%, in both themes, with nothing cut", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("skipped without local stack");
  test.setTimeout(120_000);
  const { userId, db } = await signUp(context, baseURL, "states");
  const day = 86_400_000;
  const time = new Date(Date.now() - 40 * day).toISOString();
  const deck = { id: randomUUID(), user_id: userId, name: "영단어 기본", visibility: "private" };
  expect(
    (await db.from("decks").insert({ ...deck, created_at: time, updated_at: time })).error,
  ).toBeNull();
  const card = (word: string) => ({
    id: randomUUID(),
    deck_id: deck.id,
    user_id: userId,
    front: [text("f", word)],
    back: [text("b", `${word}의 뜻`)],
    card_key: word,
    source: "manual",
    template: "free",
    template_version: 2,
    created_at: time,
    updated_at: time,
  });
  const state = (id: string, lastReview: number, due: number, stability: number) => ({
    user_id: userId,
    card_id: id,
    stability,
    difficulty: 5,
    last_review: new Date(lastReview).toISOString(),
    due: new Date(due).toISOString(),
    updated_at: time,
  });

  // The day done: one card answered an hour ago, due again tomorrow.
  const done = card("ephemeral");
  expect((await db.from("cards").insert(done)).error).toBeNull();
  expect(
    (
      await db
        .from("card_states")
        .insert(state(done.id, Date.now() - 3_600_000, Date.now() + day, 1))
    ).error,
  ).toBeNull();
  expect(
    (
      await db.from("reviews").insert({
        id: randomUUID(),
        card_id: done.id,
        user_id: userId,
        rating: "good",
        reviewed_at: new Date(Date.now() - 3_600_000).toISOString(),
        duration_ms: 6000,
        updated_at: time,
      })
    ).error,
  ).toBeNull();
  await page.goto("/");
  await expect(page.getByRole("link", { name: "학습하기", exact: true })).toBeVisible();
  // At 140 the sleepy mascot breathes.
  await expect
    .soft(page.locator('svg.mascot[data-expression="sleepy"]'))
    .toHaveAttribute("data-motion", "full");
  await capture(page, "home-done");

  // A backlog, another account's: three cards a month overdue and nothing else, against a
  // load of well under one a day.
  const backlog = await signUp(context, baseURL, "backlog");
  const notes = { ...deck, id: randomUUID(), user_id: backlog.userId };
  expect(
    (await backlog.db.from("decks").insert({ ...notes, created_at: time, updated_at: time })).error,
  ).toBeNull();
  const overdue = ["meticulous", "ubiquitous", "candid"].map((word) => ({
    ...card(word),
    deck_id: notes.id,
    user_id: backlog.userId,
  }));
  expect((await backlog.db.from("cards").insert(overdue)).error).toBeNull();
  expect(
    (
      await backlog.db.from("card_states").insert(
        overdue.map((row) => ({
          ...state(row.id, Date.now() - 31 * day, Date.now() - day, 30),
          user_id: backlog.userId,
        })),
      )
    ).error,
  ).toBeNull();
  await page.goto("/");
  await expect(page.getByText("다시 시작하면 돼요", { exact: true })).toBeVisible();
  await capture(page, "home-backlog");
});

test("gives the browser's bar the sky's colour in the theme the user chose, the ground's from 1024 px, and the root layout's again off 홈", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("skipped without local stack");
  await signUp(context, baseURL, "bar");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "첫 노트를 만들어 볼까요?" })).toBeVisible();
  // The sky's colour, `hero`, in the system's light theme.
  await expect.poll(() => themeColor(page)).toBe("#2547d0");
  // 다크 chosen on a light system: the dark sky's, not the system's light one.
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await expect.poll(() => themeColor(page)).toBe("#1a2f78");
  // 라이트 chosen on a dark system: the light sky's.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
  await expect.poll(() => themeColor(page)).toBe("#2547d0");
  // Control: back to the system's, dark, the dark sky's.
  await page.evaluate(() => {
    delete document.documentElement.dataset.theme;
  });
  await expect.poll(() => themeColor(page)).toBe("#1a2f78");
  // From 1024 px the sky is in the column: the ground's.
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect.poll(() => themeColor(page)).toBe("#111a2e");
  // Off 홈, by the tab bar, the root layout's colours and no cover come back.
  await page.setViewportSize({ width: 390, height: 844 });
  await untilReacted(
    () =>
      page
        .getByRole("navigation", { name: "주 메뉴" })
        .last()
        .getByRole("link", { name: "노트" })
        .click(),
    async () => (await page.getByRole("heading", { level: 1, name: "노트" }).count()) > 0,
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.head.querySelectorAll('meta[name="theme-color"]')].map(
          (meta) => meta.getAttribute("media") ?? "",
        ),
      ),
    )
    .toEqual(["(prefers-color-scheme: light)", "(prefers-color-scheme: dark)"]);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? "",
      ),
    )
    .not.toContain("viewport-fit=cover");
});

/**
 * Where the side menu's parts start, in whole px from the viewport's left: the lockup as drawn,
 * the leading box of each item and of the profile (its pill or circle), and each label's first
 * letter, the items and the profile named by their labels.
 */
function menuEdges(page: Page) {
  return page
    .getByRole("navigation", { name: "주 메뉴" })
    .first()
    .evaluate((nav) => {
      // A row's label, its own text beside its pill or circle, and where its first letter starts.
      const label = (element: Element) => {
        const node = [...element.childNodes].find(
          (child) => child.nodeType === Node.TEXT_NODE && (child.textContent ?? "").trim() !== "",
        );
        if (!node) return { label: null, text: null };
        const range = document.createRange();
        range.selectNodeContents(node);
        return {
          label: (node.textContent ?? "").trim(),
          text: Math.round(range.getBoundingClientRect().left),
        };
      };
      const lockup = [...nav.querySelectorAll("a img")].find(
        (image) => image.getBoundingClientRect().width > 0,
      );
      const rows = [...nav.querySelectorAll("a")].filter((link) => !link.querySelector("img"));
      return {
        lockup: lockup ? Math.round(lockup.getBoundingClientRect().left) : null,
        boxes: rows.map((row) => ({
          ...label(row),
          box: row.firstElementChild
            ? Math.round(row.firstElementChild.getBoundingClientRect().left)
            : null,
        })),
      };
    });
}

/**
 * How many times the app's name is drawn on [page]: the lockup's image, and each element whose
 * own text is 알아몰라, unless it or a box around it is no bigger than the pixel a visually hidden
 * element is clipped to.
 */
function drawnNames(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLElement>("body *")].filter((element) => {
        for (let at: Element | null = element; at; at = at.parentElement) {
          const box = at.getBoundingClientRect();
          if (box.width <= 1 || box.height <= 1) return false;
        }
        if (element instanceof HTMLImageElement)
          return element.alt === "" && element.closest("nav") !== null;
        return [...element.childNodes].some(
          (node) =>
            node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() === "알아몰라",
        );
      }).length,
  );
}

test("draws 알아몰라 once on 홈 from 1024 px, the side menu's lockup, and starts the lockup, 기록, 홈, 노트 and 설정 on one left edge with their labels on one x", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("skipped without local stack");
  // Four pages at three widths in two themes each.
  test.setTimeout(120_000);
  const { userId, db } = await signUp(context, baseURL, "menu");
  const time = new Date(Date.now() - 86_400_000).toISOString();
  const deck = randomUUID();
  const inserted = await db.from("decks").insert({
    id: deck,
    user_id: userId,
    name: "영단어 기본",
    color: "blue",
    visibility: "private",
    created_at: time,
    updated_at: time,
  });
  expect(inserted.error).toBeNull();
  const card = await db.from("cards").insert({
    id: randomUUID(),
    deck_id: deck,
    user_id: userId,
    front: [text("f", "ephemeral")],
    back: [text("b", "덧없는")],
    card_key: "ephemeral",
    source: "manual",
    template: "free",
    template_version: 2,
    created_at: time,
    updated_at: time,
  });
  expect(card.error).toBeNull();

  const directory = process.env.E2E_SCREENSHOTS;
  const edges: Record<string, Awaited<ReturnType<typeof menuEdges>>> = {};
  const names: Record<string, number> = {};
  // Every shot is taken before anything is asserted, so a failing run still shows each page. Each
  // page is shot once what it read is drawn, not its skeleton.
  for (const { name, path, ready } of [
    {
      name: "home",
      path: "/",
      ready: page.getByRole("heading", { name: "오늘 1장", exact: true }),
    },
    { name: "notes", path: "/decks", ready: page.getByRole("region", { name: "노트 목록" }) },
    { name: "record", path: "/record", ready: page.getByRole("radiogroup", { name: "기간" }) },
    {
      name: "settings",
      path: "/account",
      ready: page.getByRole("button", { name: "로그아웃", exact: true }),
    },
  ]) {
    await page.goto(path);
    await expect(ready).toBeVisible();
    for (const [width, height] of [
      [390, 844],
      [1024, 768],
      [1280, 800],
    ] as const) {
      await page.setViewportSize({ width, height });
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        if (directory)
          await page.screenshot({
            path: `${directory}/menu/${colorScheme}/web-${name}-${String(width)}.png`,
            fullPage: true,
          });
      }
      await page.emulateMedia({ colorScheme: "light" });
      if (width === 390) continue;
      edges[`${name} at ${String(width)}`] = await menuEdges(page);
      if (name === "home") names[`홈 at ${String(width)}`] = await drawnNames(page);
    }
  }
  // Control: 홈 is still named 알아몰라 by its heading, for a screen reader.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "알아몰라", exact: true })).toHaveCount(1);

  expect(names).toEqual({ "홈 at 1024": 1, "홈 at 1280": 1 });
  for (const [at, { lockup, boxes }] of Object.entries(edges)) {
    // Setup: the lockup and each of 기록, 홈, 노트 and 설정 are drawn.
    expect(
      boxes.map(({ label }) => label),
      at,
    ).toEqual(["기록", "홈", "노트", "설정"]);
    expect(lockup, at).not.toBeNull();
    const starts: Record<string, number | null> = { 알아몰라: lockup };
    const labels: Record<string, number | null> = {};
    for (const row of boxes) {
      starts[row.label ?? ""] = row.box;
      labels[row.label ?? ""] = row.text;
    }
    expect(new Set(Object.values(starts)).size, `${at} starts at ${JSON.stringify(starts)}`).toBe(
      1,
    );
    expect(new Set(Object.values(labels)).size, `${at} labels at ${JSON.stringify(labels)}`).toBe(
      1,
    );
  }
});
