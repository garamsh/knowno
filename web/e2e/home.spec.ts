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
 * Waits until the happy [mascot] is the drawing it keeps at its size. The server draws it still;
 * on screen from 200 px across, the client puts its moving drawing in the still one's place
 * (ADR 0152), and a box read across that swap finds no element.
 */
async function untilMascotSettled(mascot: Locator): Promise<void> {
  await expect
    .poll(() =>
      mascot.evaluate(
        (element) => element.tagName === "svg" || element.getBoundingClientRect().width < 200,
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

test("draws the first-run home, 홈 over its week card, the 노트 page, a note, its 카드 추가 sheet and 새 노트, a pair of buttons on one line", async ({
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
  await expectEdge(
    first,
    first.getByRole("link", { name: "카드 추가", exact: true }),
    "--color-on-hero-edge",
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
  // At a phone's width 홈 holds no note: the week card under the hero, above the tab bar.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("region", { name: "노트 목록" })).toHaveCount(0);
  const [tabBar, week] = await Promise.all([
    page.getByRole("navigation", { name: "주 메뉴" }).last().boundingBox(),
    page.getByRole("region", { name: "0일 연속" }).boundingBox(),
  ]);
  if (!tabBar || !week) throw new Error("the tab bar and the week card are drawn");
  expect(week.y + week.height).toBeLessThanOrEqual(tabBar.y);
  await expectEdge(
    page,
    page.getByRole("link", { name: "시작", exact: true }),
    "--color-on-hero-edge",
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
  ).toBe(46);
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

test("fits 홈 to the screen with the owner's 481 cards over four notes on a 19-day streak: 시작 and the week card whole above the tab bar, the mascot giving way from 210 to 64", async ({
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
  const hero = page.getByRole("region", { name: "오늘 481장" });
  await expect(hero.getByRole("heading", { name: "오늘 481장", exact: true })).toBeVisible();
  const week = page.getByRole("region", { name: "19일 연속" });
  await expect(week.getByText("지난 7일 267장", { exact: true })).toBeVisible();
  const start = hero.getByRole("link", { name: "시작", exact: true });
  const mascot = hero.locator("img, svg").first();
  await untilMascotSettled(mascot);
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
          path: `${directory}/${colorScheme}/web-home-fit-${String(height)}.png`,
        });
      const [button, drawn, card, tabBar, scroll] = await Promise.all([
        start.boundingBox(),
        mascot.boundingBox(),
        week.boundingBox(),
        page.getByRole("navigation", { name: "주 메뉴" }).last().boundingBox(),
        page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight),
      ]);
      if (!button || !drawn || !card || !tabBar)
        throw new Error(
          `홈 is drawn ${at}, but not: ${undrawn({ 시작: button, mascot: drawn, "the week card": card, "the tab bar": tabBar })}`,
        );
      // Nothing to scroll: 시작 and the week card whole on the first screen, the week card under
      // 시작 and above the tab bar; each size is checked, and shot, whatever an earlier one found.
      expect.soft(scroll, at).toBeLessThanOrEqual(0);
      expect.soft(button.y, at).toBeGreaterThanOrEqual(0);
      expect.soft(button.y + button.height, at).toBeLessThanOrEqual(card.y);
      expect.soft(card.y + card.height, at).toBeLessThanOrEqual(tabBar.y);
      // The mascot gives way, from 210 down to its floor of 64, square.
      expect.soft(drawn.height, at).toBeGreaterThanOrEqual(64);
      expect.soft(drawn.height, at).toBeLessThanOrEqual(210);
      expect.soft(drawn.width, at).toBeCloseTo(drawn.height, 0);
    }
    // The owner's four notes on the 노트 page.
    if (directory) {
      await page.goto("/decks");
      await expect(page.getByRole("region", { name: "노트 목록" }).getByRole("link")).toHaveCount(
        4,
      );
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await page.screenshot({
          path: `${directory}/${colorScheme}/web-notes-${String(height)}.png`,
        });
      }
      await page.goto("/");
      // 홈 itself, not its skeleton, is what the next size measures and shoots.
      await expect(week.getByText("지난 7일 267장", { exact: true })).toBeVisible();
      await untilMascotSettled(mascot);
    }
  }
  // Control: given the room, the mascot is drawn at its full 210.
  await page.setViewportSize({ width: 430, height: 1300 });
  expect((await mascot.boundingBox())?.height).toBe(210);
  // Short of room for the floor, the mascot holds at 64 and the page scrolls, 시작 still above
  // the week card.
  await page.setViewportSize({ width: 375, height: 420 });
  const [floor, button, card] = await Promise.all([
    mascot.boundingBox(),
    start.boundingBox(),
    week.boundingBox(),
  ]);
  if (!floor || !button || !card)
    throw new Error(
      `홈 is drawn at 375 × 420, but not: ${undrawn({ mascot: floor, 시작: button, "the week card": card })}`,
    );
  expect(floor.height).toBe(64);
  expect(button.y + button.height).toBeLessThanOrEqual(card.y);
});
