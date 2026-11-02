import { randomUUID } from "node:crypto";

import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

import { untilReacted } from "./until-reacted";

// The local stack scripts/test-web.sh starts, whose URL and publishable key the app was built
// with. Password sign-up and sign-in are enabled on the local stack alone (supabase/config.toml).
const supabaseUrl = process.env.E2E_SUPABASE_URL;
const supabaseKey = process.env.E2E_SUPABASE_KEY;

test.skip(
  !supabaseUrl || !supabaseKey,
  "needs the local Supabase stack scripts/test-web.sh starts, which sets E2E_SUPABASE_URL and E2E_SUPABASE_KEY",
);

// Where to save screenshots of each screen in both themes, for review; none are taken unless it
// names a directory.
const screenshots = process.env.E2E_SCREENSHOTS;

async function shot(page: Page, name: string) {
  if (!screenshots) return;
  const viewport = page.viewportSize();
  // A wide screen with the side menu, and a phone with the tab bar.
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.screenshot({
        path: `${screenshots}/${colorScheme}/web-${name}-${String(width)}.png`,
        fullPage: true,
      });
    }
  }
  if (viewport) await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: null });
}

/**
 * Signs up a new user with a password and gives [context] the session cookies a browser holds
 * after signing in, written by @supabase/ssr itself.
 */
async function signUpInBrowser(
  context: BrowserContext,
  baseURL: string,
  email: string,
  password: string,
) {
  if (!supabaseUrl || !supabaseKey) throw new Error("skipped above");
  const cookies = new Map<string, string>();
  const browserSession = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
      setAll: (written) => {
        for (const { name, value } of written) cookies.set(name, value);
      },
    },
  });
  const signUp = await browserSession.auth.signUp({ email, password });
  expect(signUp.error).toBeNull();
  expect(cookies.size).toBeGreaterThan(0);
  await context.addCookies([...cookies].map(([name, value]) => ({ name, value, url: baseURL })));
  return signUp.data.user?.id;
}

// What the browser reported, printed when the test fails: the write runs out of sight.
const browserLog: string[] = [];
test.afterEach(({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) console.log(browserLog.join("\n"));
  browserLog.length = 0;
});

test("a signed-in user studies two cards, and the server holds their reviews and states", async ({
  page,
  context,
  baseURL,
}) => {
  if (!supabaseUrl || !supabaseKey || !baseURL) throw new Error("skipped above");
  page.on("console", (message) => browserLog.push(`console ${message.type()}: ${message.text()}`));
  page.on("requestfailed", (request) =>
    browserLog.push(
      `failed ${request.method()} ${request.url()}: ${request.failure()?.errorText ?? ""}`,
    ),
  );
  page.on("response", (response) => {
    if (response.request().method() === "POST") {
      browserLog.push(`POST ${response.url()} answered ${String(response.status())}`);
    }
  });
  const email = `web-study-${randomUUID()}@example.com`;
  const password = "web-study-password";

  await page.goto("/login");
  await shot(page, "00-login");
  const userId = await signUpInBrowser(context, baseURL, email, password);

  // The phone's sync has pushed a deck with one new card.
  const phone = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  expect((await phone.auth.signInWithPassword({ email, password })).error).toBeNull();
  const deckId = randomUUID();
  const now = new Date().toISOString();
  const side = (text: string) => [{ type: "text", payload: { text } }];
  // Two new cards, so the second is shown under the first one's answer; the deck is published.
  const backs = new Map([
    ["chat", "cat"],
    ["chien", "dog"],
  ]);
  const cardIds = new Map([...backs.keys()].map((front) => [front, randomUUID()]));
  expect(
    (
      await phone.from("decks").insert({
        id: deckId,
        user_id: userId,
        name: "French",
        visibility: "public",
        published_at: now,
        created_at: now,
        updated_at: now,
      })
    ).error,
  ).toBeNull();
  expect(
    (
      await phone.from("cards").insert(
        [...backs].map(([front, back]) => ({
          id: cardIds.get(front),
          user_id: userId,
          deck_id: deckId,
          front: side(front),
          back: side(back),
          card_key: front,
          source: "manual",
          created_at: now,
          updated_at: now,
        })),
      )
    ).error,
  ).toBeNull();

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "오늘 할 카드", exact: true })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "2장 중 0장", exact: true })).toBeVisible();
  // The minutes are set in 설정 alone.
  await expect(page.getByRole("button", { name: /하루 학습 시간/ })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "French, 오늘 2장 학습", exact: true }),
  ).toHaveAttribute("href", `/study?decks=${deckId}`);
  // 오늘 carries no account content; the account page does.
  await expect(page.getByText(email)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "로그아웃" })).toHaveCount(0);
  await shot(page, "01-today");
  // The account page's 하루 학습 시간 row opens the daily study minutes' dialog, which saves on
  // the server.
  await page.goto("/account");
  await page.getByRole("button", { name: "하루 학습 시간 20분", exact: true }).click();
  const minutes = page.getByRole("dialog", { name: "하루 학습 시간" });
  // The tiles' region holds both tiles, so each value is matched as part of it.
  await expect(minutes.getByRole("status")).toContainText("약 2장");
  await shot(page, "01c-daily-minutes");
  // The number is typed in place; a number outside 5 to 180 holds 저장 until it is fixed.
  await minutes.getByRole("button", { name: "하루 20분, 눌러서 직접 입력", exact: true }).click();
  const typed = minutes.getByRole("textbox", { name: "하루 학습 시간(분)", exact: true });
  await typed.fill("200");
  await expect(
    minutes.getByText("5분에서 180분 사이로 입력해 주세요", { exact: true }),
  ).toBeVisible();
  await expect(minutes.getByRole("button", { name: "저장", exact: true })).toBeDisabled();
  await shot(page, "01c-daily-minutes-typed");
  await typed.fill("30");
  await typed.press("Enter");
  await expect(
    minutes.getByRole("button", { name: "하루 30분, 눌러서 직접 입력", exact: true }),
  ).toBeFocused();
  // Both cards start today; matched as part of the tiles' region, as above.
  await expect(minutes.getByRole("status")).toContainText("오늘");
  await minutes.getByRole("button", { name: "저장", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "하루 학습 시간 30분", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "하루 학습 시간 30분", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("link", { name: "덱", exact: true })
    .click();
  const deckRow = page.getByRole("link", {
    name: "French, 카드 2장, 공개, 오늘 2, 2장 중 0장 익힘, 익힘 0장, 학습 중 0장, 새 카드 2장",
    exact: true,
  });
  await expect(deckRow).toBeVisible();
  await shot(page, "01b-decks");
  await deckRow.click();
  await expect(page.getByRole("heading", { name: "French", exact: true })).toBeVisible();
  // Every answer hidden until it is asked for: one click shows that card's, 뒷면 보기 them all.
  await expect(page.getByRole("button", { name: "chat, 뒷면 가려짐", exact: true })).toBeVisible();
  await shot(page, "02-deck");
  const backsShown = page.getByRole("button", { name: "chat, 뒷면 cat", exact: true });
  await untilReacted(
    () => page.getByRole("switch", { name: "뒷면 보기" }).click(),
    async () => (await backsShown.count()) > 0,
  );
  await expect(page.getByRole("button", { name: "chien, 뒷면 dog", exact: true })).toBeVisible();
  await shot(page, "02b-deck-answers");
  // Enter opens the deck's session.
  await page.getByRole("heading", { name: "French", exact: true }).click();
  const studyPath = new RegExp(`/study\\?decks=${deckId}&from=deck$`);
  await untilReacted(
    () => page.keyboard.press("Enter"),
    () => Promise.resolve(studyPath.test(page.url())),
  );

  const front = page.getByRole("group", { name: "앞면", exact: true });
  const currentCard = page.getByRole("region", { name: "현재 카드", exact: true });
  await expect(front).toHaveText(/^(chat|chien)$/);
  const first = (await front.textContent()) ?? "";
  // A device's first session: the coach's caption in the answer buttons' place, over the empty
  // previous card's place.
  const coach = page.getByRole("region", { name: "학습 사용 방법" });
  await expect(coach).toContainText("알면 안다(→)를 눌러요");
  await expect(page.getByRole("region", { name: "응답한 카드가 여기에 쌓여요" })).toBeVisible();
  await shot(page, "03a-study-coach");
  // The current card shows its front alone; its back shows once answered, above.
  await expect(currentCard).not.toContainText(backs.get(first) ?? "");
  await shot(page, "03-study-front");
  const second = first === "chat" ? "chien" : "chat";
  await untilReacted(
    () => page.keyboard.press("ArrowRight"),
    async () => (await front.textContent()) === second,
  );
  await expect(
    page.getByRole("complementary", { name: "이번 학습" }).getByRole("button"),
  ).toHaveCount(1);
  await expect(currentCard).not.toContainText(backs.get(second) ?? "");
  // The first answer ended the coach and took the empty place.
  await expect(coach).toHaveCount(0);
  await expect(page.getByRole("region", { name: "응답한 카드가 여기에 쌓여요" })).toHaveCount(0);
  await shot(page, "05-study-stack");
  // The today card once one of the day's two cards is done, in a second tab: its count and bar,
  // and the minutes left, once the answer's write has landed.
  const todayTab = await page.context().newPage();
  await todayTab.goto("/");
  await expect(async () => {
    await todayTab.reload();
    await expect(
      todayTab.getByRole("progressbar", { name: "2장 중 1장", exact: true }),
    ).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(todayTab.getByText(/^약 \d+분 남음$/)).toBeVisible();
  await shot(todayTab, "01a-today-started");
  await todayTab.close();
  // A click on the previous card opens it whole; Esc closes it, and the session goes on.
  await page.getByRole("button", { name: "카드 전체 보기", exact: true }).click();
  const detail = page.getByRole("dialog", { name: "카드", exact: true });
  await expect(detail.getByText(backs.get(first) ?? "", { exact: true })).toBeVisible();
  await shot(page, "05b-study-detail");
  await page.keyboard.press("Escape");
  await expect(detail).toHaveCount(0);
  await expect(front).toHaveText(second);
  // At a phone's width: the same cards with the large answer buttons, and no list beside.
  const desktop = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("complementary", { name: "이번 학습" })).toBeHidden();
  await shot(page, "05c-study-phone-width");
  if (desktop) await page.setViewportSize(desktop);
  await page.keyboard.press("ArrowRight");
  // No card is left today: the completion card takes the current card's place, below the stack.
  const completion = page.getByRole("region", { name: "오늘 학습 완료", exact: true });
  await expect(completion).toBeVisible();
  await expect(front).toHaveCount(0);
  await expect(
    page.getByRole("complementary", { name: "이번 학습" }).getByRole("button"),
  ).toHaveCount(2);
  await expect(completion.getByText("2 안다", { exact: true })).toBeVisible();
  await expect(completion.getByText("연속 1일", { exact: true })).toBeVisible();
  await shot(page, "06-study-complete");

  // The writes ran after the screen changed; each state is written after its review.
  await expect
    .poll(async () => (await phone.from("card_states").select("card_id")).data?.length)
    .toBe(2);
  const reviews = await phone.from("reviews").select("card_id, rating, fuzz_factor, revision");
  expect(reviews.error).toBeNull();
  expect(reviews.data).toEqual(
    expect.arrayContaining(
      [...cardIds.values()].map((cardId) =>
        expect.objectContaining({
          card_id: cardId,
          rating: "good",
          fuzz_factor: expect.any(Number),
        }),
      ),
    ),
  );
  expect(reviews.data).toHaveLength(2);
  const states = await phone.from("card_states").select("card_id, stability, due, revision");
  expect(states.data).toHaveLength(2);
  for (const state of states.data ?? []) {
    expect(state).toEqual(expect.objectContaining({ stability: expect.any(Number) }));
    // A new card answered 안다 is next due days from now, as the engine schedules it.
    expect(Date.parse(String(state.due))).toBeGreaterThan(Date.now() + 86_400_000);
  }

  // No new card is left past today's: the completion card says so, and offers no 학습하기.
  await expect(completion.getByText("더 학습할 카드가 없어요", { exact: true })).toBeVisible();
  await expect(completion.getByRole("button", { name: "학습하기" })).toHaveCount(0);

  // A change whose write fails is not dropped by leaving: Esc sends it again, and when that
  // fails too, asks first. The Server Action posts to this page's address.
  const refuse = (url: URL) => url.pathname === "/study";
  await page.route(refuse, (route) =>
    route.request().method() === "POST" ? route.abort() : route.continue(),
  );
  // The route is set before the browser applies it, and a write sent in between goes through and
  // shows no failure (#415); the step waits until a POST of the page is refused.
  await expect
    .poll(() =>
      page.evaluate(() =>
        fetch(location.href, { method: "POST" }).then(
          () => "sent",
          () => "refused",
        ),
      ),
    )
    .toBe("refused");
  await page.keyboard.press("z");
  // Next's route announcer is an alert too, so the write failure is told apart by its text.
  const writeFailure = page.getByRole("alert").filter({ hasText: "응답을 저장하지 못했어요" });
  await expect(writeFailure).toBeVisible();
  await page.keyboard.press("Escape");
  const leave = page.getByRole("dialog", { name: "저장하지 않고 나갈까요?", exact: true });
  await expect(leave).toContainText("지금 나가면 저장하지 못한 응답 1개가 사라져요.");
  await expect(leave.getByRole("button", { name: "취소", exact: true })).toBeFocused();
  await shot(page, "06b-study-leave-unsaved");
  await leave.getByRole("button", { name: "취소", exact: true }).click();
  await expect(leave).toHaveCount(0);
  await expect(page).toHaveURL(studyPath);
  await page.unroute(refuse);
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(writeFailure).toHaveCount(0);
  // Z changes the card back to 안다, so the day stays done for 오늘 below.
  await page.keyboard.press("z");

  // Esc sends that write, then returns to the deck page the session was opened from.
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(`${baseURL}/decks/${deckId}`);

  // A deck whose one card is due next week, and was not answered today, has nothing to study.
  const laterDeck = randomUUID();
  const laterCard = randomUUID();
  const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString();
  expect(
    (
      await phone.from("decks").insert({
        id: laterDeck,
        user_id: userId,
        name: "Later",
        created_at: now,
        updated_at: now,
      })
    ).error,
  ).toBeNull();
  expect(
    (
      await phone.from("cards").insert({
        id: laterCard,
        user_id: userId,
        deck_id: laterDeck,
        front: side("plus tard"),
        back: side("later"),
        card_key: "plus tard",
        source: "manual",
        created_at: now,
        updated_at: now,
      })
    ).error,
  ).toBeNull();
  expect(
    (
      await phone.from("card_states").insert({
        user_id: userId,
        card_id: laterCard,
        stability: 7,
        difficulty: 5,
        last_review: now,
        due: nextWeek,
        updated_at: now,
      })
    ).error,
  ).toBeNull();
  await page.goto(`/study?decks=${laterDeck}`);
  await expect(page.getByText("오늘은 학습할 카드가 없어요", { exact: true })).toBeVisible();
  await expect(completion).toHaveCount(0);
  await shot(page, "06c-study-nothing-today");

  // With the day's cards done, 오늘 draws the done card and its navy 학습하기 (#275).
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "오늘 할 카드를 다 했어요", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "학습하기", exact: true })).toBeVisible();
  await shot(page, "01d-today-done");

  // Ten cards overdue after a month's interval are far more than three days' load: a backlog.
  const behindDeck = randomUUID();
  expect(
    (
      await phone.from("decks").insert({
        id: behindDeck,
        user_id: userId,
        name: "Behind",
        created_at: now,
        updated_at: now,
      })
    ).error,
  ).toBeNull();
  const behind = Array.from({ length: 10 }, (_, index) => ({ id: randomUUID(), index }));
  expect(
    (
      await phone.from("cards").insert(
        behind.map(({ id, index }) => ({
          id,
          user_id: userId,
          deck_id: behindDeck,
          front: side(`retard ${String(index)}`),
          back: side(`behind ${String(index)}`),
          card_key: `retard ${String(index)}`,
          source: "manual",
          created_at: now,
          updated_at: now,
        })),
      )
    ).error,
  ).toBeNull();
  expect(
    (
      await phone.from("card_states").insert(
        behind.map(({ id }) => ({
          user_id: userId,
          card_id: id,
          stability: 30,
          difficulty: 5,
          last_review: new Date(Date.now() - 31 * 86_400_000).toISOString(),
          due: new Date(Date.now() - 86_400_000).toISOString(),
          updated_at: now,
        })),
      )
    ).error,
  ).toBeNull();
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "다시 시작하면 돼요", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: /따라잡아요$/ })).toBeVisible();
  await shot(page, "01e-today-backlog");

  await page.goto("/account");
  await expect(page.getByRole("heading", { level: 1, name: "설정", exact: true })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
  await shot(page, "07-account");
});

test("a user with no deck is invited to make one, and the theme they choose survives a reload", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("skipped above");
  await signUpInBrowser(context, baseURL, `web-empty-${randomUUID()}@example.com`, "web-empty-pw");

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "첫 덱을 만들어 볼까요?", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "모두 학습" })).toHaveCount(0);
  await shot(page, "08-empty-home");

  await page.goto("/account");
  const group = page.getByRole("radiogroup", { name: "화면", exact: true });
  const body = page.locator("body");
  await expect(group.getByRole("radio", { name: "시스템", exact: true })).toBeChecked();
  // The system's dark mode, so 라이트 differs from it and 다크 from the default's light.
  await page.emulateMedia({ colorScheme: "dark" });
  const ground = { light: "rgb(255, 246, 232)", dark: "rgb(31, 21, 18)" };
  for (const [choice, label, colour] of [
    ["light", "라이트", ground.light],
    ["dark", "다크", ground.dark],
    ["system", "시스템", ground.dark],
  ] as const) {
    // The root's data-theme, which only the choice's handler sets, names it; the system's names none.
    await untilReacted(
      () => group.getByText(label, { exact: true }).click(),
      async () =>
        (await page.evaluate(() => document.documentElement.dataset.theme ?? "system")) === choice,
    );
    await expect(body).toHaveCSS("background-color", colour);

    await page.reload();

    await expect(group.getByRole("radio", { name: label, exact: true })).toBeChecked();
    await expect(body).toHaveCSS("background-color", colour);
    if (screenshots) {
      await page.screenshot({
        path: `${screenshots}/choice/web-09-account-${choice}.png`,
        fullPage: true,
      });
    }
  }
  await page.emulateMedia({ colorScheme: null });
});

test("each page that waits on the server shows its skeleton, still under reduced motion, where its content then lands", async ({
  browser,
  context,
  baseURL,
}) => {
  if (!supabaseUrl || !supabaseKey || !baseURL) throw new Error("skipped above");
  const email = `web-skeleton-${randomUUID()}@example.com`;
  const password = "web-skeleton-pw";
  const userId = await signUpInBrowser(context, baseURL, email, password);
  const phone = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  expect((await phone.auth.signInWithPassword({ email, password })).error).toBeNull();
  const deckId = randomUUID();
  const now = new Date().toISOString();
  expect(
    (
      await phone.from("decks").insert({
        id: deckId,
        user_id: userId,
        name: "French",
        created_at: now,
        updated_at: now,
      })
    ).error,
  ).toBeNull();
  const cardId = randomUUID();
  expect(
    (
      await phone.from("cards").insert({
        id: cardId,
        user_id: userId,
        deck_id: deckId,
        front: [{ type: "text", payload: { text: "chat" } }],
        back: [{ type: "text", payload: { text: "cat" } }],
        card_key: "chat",
        source: "manual",
        created_at: now,
        updated_at: now,
      })
    ).error,
  ).toBeNull();

  // Without scripts React never swaps the streamed content in, so the fallback stays on screen.
  const still = await browser.newContext({ javaScriptEnabled: false });
  await still.addCookies(await context.cookies());
  const skeletonPage = await still.newPage();
  const livePage = await context.newPage();
  // A browser's first study session shows the coach, which moves and tilts the current card from
  // 0.5 s on (#216); measured then, the card is off its place by its transform, not its layout.
  // Marking the coach as shown keeps the card where the layout puts it.
  await livePage.addInitScript(() => {
    window.localStorage.setItem("studyCoachShown", "true");
  });
  const pages = [
    {
      path: "/",
      name: "today",
      status: "오늘 할 카드를 불러오는 중이에요.",
      content: "h1",
      held: 0,
    },
    { path: "/decks", name: "decks", status: "덱을 불러오는 중이에요.", content: "h1", held: 0 },
    {
      path: `/decks/${deckId}`,
      name: "deck",
      status: "덱을 불러오는 중이에요.",
      content: '[aria-label="위치"]',
      held: 0,
    },
    {
      path: `/study?decks=${deckId}`,
      name: "study",
      status: "카드를 불러오는 중이에요.",
      content: '[aria-label="현재 카드"]',
      held: 2,
    },
    {
      path: "/account",
      name: "account",
      status: "설정을 불러오는 중이에요.",
      content: '[aria-labelledby="account-section"]',
      held: 0,
    },
  ];
  // Each page names its first block of content and the placeholder that holds its place.
  for (const { path, name, status, content, held: placeholder } of pages) {
    await skeletonPage.emulateMedia({ reducedMotion: "no-preference" });
    await skeletonPage.goto(path);
    // The visible fallback: the study page's streamed content, never swapped in without scripts,
    // holds a hidden skeleton of its own until the engine loads.
    const busy = skeletonPage.locator('[aria-busy="true"]').filter({ visible: true });
    await expect(busy).toBeVisible();
    await expect(skeletonPage.getByRole("status")).toHaveText(status);
    const placeholders = busy.locator('> [aria-hidden="true"]');
    await expect(placeholders).toHaveCSS("animation-name", "skeleton");
    if (screenshots) {
      for (const colorScheme of ["light", "dark"] as const) {
        await skeletonPage.emulateMedia({ colorScheme });
        await skeletonPage.screenshot({
          path: `${screenshots}/${colorScheme}/web-10-skeleton-${name}.png`,
          fullPage: true,
        });
      }
      await skeletonPage.emulateMedia({ colorScheme: null });
    }

    await skeletonPage.emulateMedia({ reducedMotion: "reduce" });
    await expect(placeholders).toHaveCSS("animation-name", "none");

    // The first block of content takes the place its placeholder held.
    const held = await placeholders.locator("> *").nth(placeholder).boundingBox();
    await livePage.goto(path);
    const block = livePage.locator(content).first();
    await expect(block).toBeVisible();
    const landed = await block.boundingBox();
    expect({ name, top: landed?.y }).toEqual({ name, top: held?.y });
  }
  await still.close();
});

test("the settings page wraps an email too long for one line inside its group", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("skipped above");
  const email = `web-avatar-${randomUUID()}@a-long-subdomain-that-takes-the-email-past-the-card.example.com`;
  await signUpInBrowser(context, baseURL, email, "web-avatar-pw");

  await page.goto("/account");
  const section = page.getByRole("region", { name: "계정", exact: true });
  const shown = section.getByText(email, { exact: true });
  await expect(shown).toBeVisible();
  await shot(page, "11-account-long-email");
  const group = shown.locator("..");
  const groupBox = await group.boundingBox();
  const emailBox = await shown.boundingBox();
  const lineHeight = await shown.evaluate((node) => parseFloat(getComputedStyle(node).lineHeight));
  // The email wraps, so it is long enough to overflow the group if it could not.
  expect(emailBox?.height).toBeGreaterThan(lineHeight);
  // The email stays inside the group.
  if (!groupBox || !emailBox) throw new Error("the group and the email are visible above");
  expect(emailBox.x + emailBox.width).toBeLessThanOrEqual(groupBox.x + groupBox.width);
});

/** A Korean paragraph of at least [length] characters, ending at a word. */
function longKorean(length: number) {
  const text =
    "광합성은 식물이 빛 에너지를 이용해 이산화탄소와 물로부터 포도당을 만드는 과정이다. " +
    "엽록체의 틸라코이드 막에서 일어나는 명반응은 빛을 흡수해 물을 분해하고 산소를 내보내며 " +
    "ATP와 NADPH를 만든다. 스트로마에서 일어나는 캘빈 회로는 이 에너지를 써서 이산화탄소를 " +
    "고정하고 포도당을 합성한다. 빛의 세기, 이산화탄소 농도, 온도는 광합성 속도를 결정하는 " +
    "주요 요인이며, 이 중 가장 부족한 요인이 전체 속도를 제한한다. 이를 최소량의 법칙이라고 " +
    "부른다. 따라서 온실에서 작물을 키울 때는 빛을 충분히 비추는 것만으로는 부족하고, " +
    "이산화탄소를 공급하고 온도를 알맞게 유지해야 수확량이 늘어난다. 또한 식물은 낮에 만든 " +
    "포도당을 녹말로 바꾸어 저장하고, 밤에는 이를 다시 분해해 호흡에 쓴다. " +
    "잎의 기공은 이산화탄소를 들이고 수증기를 내보내는 통로인데, 날이 가물면 기공이 닫혀 " +
    "광합성이 줄어든다.";
  const end = text.indexOf(" ", length);
  return end < 0 ? text : text.slice(0, end);
}

test("a card of 100, 200 and 400 characters, and one of several senses, are studied whole", async ({
  page,
  context,
  baseURL,
}) => {
  if (!supabaseUrl || !supabaseKey || !baseURL) throw new Error("skipped above");
  const email = `web-long-${randomUUID()}@example.com`;
  const password = "web-long-password";
  await page.goto("/login");
  const userId = await signUpInBrowser(context, baseURL, email, password);
  const phone = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  expect((await phone.auth.signInWithPassword({ email, password })).error).toBeNull();
  const deckId = randomUUID();
  const now = new Date().toISOString();
  const text = (value: string) => ({ type: "text", payload: { text: value } });
  const verb = { kind: "part_of_speech", category: "verb", text: "동" };
  const senses = {
    type: "senses",
    payload: {
      senses: [
        { labels: [verb], meaning: "달리다, 뛰다", examples: ["She runs every morning."] },
        { labels: [verb], meaning: "운영하다, 경영하다", examples: ["They run a bakery."] },
        { labels: [verb], meaning: "(기계가) 작동하다, 돌아가다", examples: [] },
        {
          labels: [{ kind: "part_of_speech", category: "noun", text: "명" }],
          meaning: "달리기, 뛰기; 연속, 연이은 기간",
          examples: ["a run of bad luck"],
        },
      ],
    },
  };
  expect(
    (
      await phone.from("decks").insert({
        id: deckId,
        user_id: userId,
        name: "생명과학",
        created_at: now,
        updated_at: now,
      })
    ).error,
  ).toBeNull();
  const cards = [
    { front: [text(longKorean(100))], back: [text("광합성")], key: "100" },
    { front: [text(longKorean(200))], back: [text(longKorean(100))], key: "200" },
    { front: [text(longKorean(400))], back: [text(longKorean(200))], key: "400" },
    { front: [text("run")], back: [senses], key: "run" },
  ];
  expect(
    (
      await phone.from("cards").insert(
        cards.map(({ front, back, key }) => ({
          id: randomUUID(),
          user_id: userId,
          deck_id: deckId,
          front,
          back,
          card_key: key,
          source: "manual",
          created_at: now,
          updated_at: now,
        })),
      )
    ).error,
  ).toBeNull();
  await page.addInitScript(() => {
    window.localStorage.setItem("studyCoachShown", "true");
  });

  await page.goto(`/study?decks=${deckId}`);
  const front = page.getByRole("group", { name: "앞면", exact: true });
  await expect(front).toBeVisible();
  const face = page.locator("[data-card-step]");
  const fade = page.locator("[data-card-fade]");
  const seen = new Set<string>();
  for (const step of [1, 2, 3, 4]) {
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
      // The face once it has stepped down for this width (ADR 0123): as wide as the face, and
      // whole at a step above the body's. Read before the face has seen the resize, it holds the
      // last width's step, so the read is taken again until the face has settled.
      let sized = { step: "", fits: false, breaks: "" };
      await expect(async () => {
        const read = await face.evaluate((node) => ({
          step: node.getAttribute("data-card-step") ?? "",
          wide: node.scrollWidth <= node.clientWidth,
          fits: node.scrollHeight <= node.clientHeight + 1,
          breaks: getComputedStyle(node.firstElementChild ?? node).wordBreak,
        }));
        sized = read;
        expect(read.wide, `${read.step} wider than the face at ${String(width)} px`).toBe(true);
        if (read.step !== "text-card-body") {
          expect(read.fits, `${read.step} at ${String(width)} px`).toBe(true);
        }
      }).toPass({ timeout: 5_000 });
      seen.add(sized.step);
      // Lines break only between words; a size above the body's fits whole, and the body's
      // scrolls with a fade when it does not.
      expect(sized.breaks).toBe("keep-all");
      if (sized.step === "text-card-body" && !sized.fits) {
        await expect(fade).toBeVisible();
        await face.evaluate((node) => {
          node.scrollTop = node.scrollHeight;
        });
        await expect(fade).toHaveCount(0);
        await face.evaluate((node) => {
          node.scrollTop = 0;
        });
      } else {
        expect(sized.fits, `${sized.step} at ${String(width)} px`).toBe(true);
      }
      // 모른다 and 안다 stay on screen whatever the card holds.
      for (const name of ["모른다", "안다"]) {
        await expect(page.getByRole("button", { name: new RegExp(`^${name}`) })).toBeInViewport();
      }
    }
    await shot(page, `07-long-study-${String(step)}`);
    const shown = (await front.textContent()) ?? "";
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => ((await front.count()) === 0 ? "" : await front.textContent()))
      .not.toBe(shown);
  }
  // Control: the cards took the body size and a size above it, so both branches above ran.
  expect(seen.has("text-card-body")).toBe(true);
  expect(seen.size).toBeGreaterThan(1);
  await shot(page, "07-long-study-done");
});

test.describe("in UTC, where a study day runs from 04:00 to 04:00 UTC", () => {
  test.use({ timezoneId: "UTC" });

  test("the record page shows the server's answers as retention, recall bands, mastered weeks and study days, read and folded on the server", async ({
    page,
    context,
    baseURL,
  }) => {
    if (!supabaseUrl || !supabaseKey || !baseURL) throw new Error("skipped above");
    const email = `web-record-${randomUUID()}@example.com`;
    const password = "web-record-password";
    await page.goto("/login");
    const userId = await signUpInBrowser(context, baseURL, email, password);

    // The phone has synced 200 cards studied over the last twelve weeks: four new cards a day,
    // each reviewed 2, 6, 15 and 35 days after its first answer, one review in nine "모른다".
    const phone = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
    expect((await phone.auth.signInWithPassword({ email, password })).error).toBeNull();
    const day = 86_400_000;
    const now = Date.now();
    const today = Date.UTC(
      new Date(now).getUTCFullYear(),
      new Date(now).getUTCMonth(),
      new Date(now).getUTCDate(),
      4,
    );
    const iso = (at: number) => new Date(at).toISOString();
    const deckId = randomUUID();
    expect(
      (
        await phone.from("decks").insert({
          id: deckId,
          user_id: userId,
          name: "Record",
          created_at: iso(now - 90 * day),
          updated_at: iso(now - 90 * day),
        })
      ).error,
    ).toBeNull();
    const cards = Array.from({ length: 200 }, (_, index) => ({
      id: randomUUID(),
      first: today - (83 - Math.floor(index / 4)) * day + 6 * 3_600_000 + index * 60_000,
    })).filter((card) => card.first < now);
    expect(
      (
        await phone.from("cards").insert(
          cards.map((card, index) => ({
            id: card.id,
            user_id: userId,
            deck_id: deckId,
            front: [{ type: "text", payload: { text: `word ${String(index)}` } }],
            back: [{ type: "text", payload: { text: String(index) } }],
            card_key: `word ${String(index)}`,
            source: "manual",
            created_at: iso(now - 90 * day),
            updated_at: iso(now - 90 * day),
          })),
        )
      ).error,
    ).toBeNull();
    const reviews = cards.flatMap((card, index) =>
      [0, 2, 6, 15, 35]
        .map((after) => card.first + after * day)
        .filter((at) => at < now)
        .map((at, step) => ({
          id: randomUUID(),
          user_id: userId,
          card_id: card.id,
          rating: (index + step) % 9 === 0 ? "again" : "good",
          reviewed_at: iso(at),
          duration_ms: 6_000,
          updated_at: iso(at),
        })),
    );
    expect((await phone.from("reviews").insert(reviews)).error).toBeNull();
    expect(
      (
        await phone.from("card_states").insert(
          cards.map((card) => {
            const last = Math.max(
              ...reviews
                .filter((review) => review.card_id === card.id)
                .map((r) => Date.parse(r.reviewed_at)),
            );
            return {
              user_id: userId,
              card_id: card.id,
              stability: 12,
              difficulty: 5,
              last_review: iso(last),
              due: iso(last + 25 * day),
              updated_at: iso(last),
            };
          }),
        )
      ).error,
    ).toBeNull();

    await page.goto("/record");
    await expect(page.getByRole("heading", { name: "기록", exact: true })).toBeVisible();
    await expect(page.getByRole("radio", { name: "30일", exact: true })).toBeChecked();
    await expect(page.getByRole("img", { name: /^복습에서 맞힌 비율, 목표 90%: / })).toBeVisible();
    await expect(
      page.getByText(/^목표보다 \d+% (낮아요|높아요)$|^목표만큼 맞혔어요$/),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: new RegExp(`^${String(cards.length)}장 중 좋음 `) }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: /^주별 익힌 카드, 7주 전부터 이번 주까지: / }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: /^최근 12주 동안 \d+일 학습했어요: / }),
    ).toBeVisible();
    // The retention's axis starts "7일 전" once the selector, which React drives, took the click.
    await untilReacted(
      () => page.getByText("7일", { exact: true }).click(),
      async () => (await page.getByText("7일 전", { exact: true }).count()) > 0,
    );
    await expect(page.getByRole("radio", { name: "7일", exact: true })).toBeChecked();

    // The warm load, against #69's bar of 1 s: the page again, now that the server process has
    // loaded the engine, timed from navigation to the end of its load.
    await page.reload();
    await expect(page.getByRole("img", { name: /^최근 12주/ })).toBeVisible();
    const warm = await page.evaluate(() => {
      const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
      return entry ? entry.loadEventEnd - entry.startTime : -1;
    });
    console.log(
      `the record page's warm load over ${String(reviews.length)} reviews: ${String(Math.round(warm))} ms`,
    );
    expect(warm).toBeGreaterThan(0);

    await page.getByText("30일", { exact: true }).click();

    // The side menu's surface and border run the page's whole height, and the menu stays in view
    // as the page scrolls (ADR 0038, #160).
    const side = page.locator('nav[aria-label="주 메뉴"]').first();
    for (const width of [1280, 1024]) {
      await page.setViewportSize({ width, height: 800 });
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });
      const heights = await side.evaluate((nav) => {
        // The box that draws the menu's border: the menu itself, or the first ancestor with one.
        let column: Element | null = nav;
        while (column && getComputedStyle(column).borderRightWidth === "0px") {
          column = column.parentElement;
        }
        return {
          document: document.documentElement.scrollHeight,
          viewport: window.innerHeight,
          column: column ? column.getBoundingClientRect().height : 0,
          surface: column ? getComputedStyle(column).backgroundColor : "",
        };
      });
      // The page is taller than the viewport, so the check can tell the two apart.
      expect(heights.document, `the record page at ${String(width)}`).toBeGreaterThan(
        heights.viewport,
      );
      expect(heights.column, `the menu's column at ${String(width)}`).toBe(heights.document);
      expect(heights.surface).toBe("rgb(255, 252, 247)");
      await page.evaluate(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
      });
      const top = await side.evaluate((nav) => nav.getBoundingClientRect().top);
      expect(top, `the menu in view after scrolling at ${String(width)}`).toBe(0);
      await expect(side.getByRole("link", { name: "기록", exact: true })).toBeInViewport();
    }
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await shot(page, "10-record");

    // 오늘's retention card: the last 30 days' figure and gap, linking here.
    await page.goto("/");
    const card = page.getByRole("region", { name: "기억률", exact: true });
    await expect(
      card.getByRole("img", { name: /^최근 30일 복습에서 맞힌 비율, 목표 90%: / }),
    ).toBeVisible();
    await expect(
      card.getByRole("link", { name: "기록에서 자세히 보기", exact: true }),
    ).toHaveAttribute("href", "/record");
    await page.reload();
    await expect(card).toBeVisible();
    const todayLoad = await page.evaluate(() => {
      const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
      return entry ? entry.loadEventEnd - entry.startTime : -1;
    });
    console.log(`오늘's warm load with the retention card: ${String(Math.round(todayLoad))} ms`);
    expect(todayLoad).toBeGreaterThan(0);
    await shot(page, "10b-today-retention");
  });

  test("the streak counts the server's earlier study days with today's answer", async ({
    page,
    context,
    baseURL,
  }) => {
    if (!supabaseUrl || !supabaseKey || !baseURL) throw new Error("skipped above");
    const email = `web-streak-${randomUUID()}@example.com`;
    const password = "web-streak-password";
    await page.goto("/login");
    const userId = await signUpInBrowser(context, baseURL, email, password);

    // The phone has synced one card, answered 24 and 48 hours ago: once on each of the two study
    // days before today.
    const phone = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
    expect((await phone.auth.signInWithPassword({ email, password })).error).toBeNull();
    const deckId = randomUUID();
    const cardId = randomUUID();
    const now = Date.now();
    const iso = (at: number) => new Date(at).toISOString();
    const side = (text: string) => [{ type: "text", payload: { text } }];
    expect(
      (
        await phone.from("decks").insert({
          id: deckId,
          user_id: userId,
          name: "Streak",
          created_at: iso(now),
          updated_at: iso(now),
        })
      ).error,
    ).toBeNull();
    expect(
      (
        await phone.from("cards").insert({
          id: cardId,
          user_id: userId,
          deck_id: deckId,
          front: side("lundi"),
          back: side("Monday"),
          card_key: "lundi",
          source: "manual",
          created_at: iso(now - 3 * 86_400_000),
          updated_at: iso(now),
        })
      ).error,
    ).toBeNull();
    expect(
      (
        await phone.from("reviews").insert(
          [1, 2].map((days) => ({
            id: randomUUID(),
            user_id: userId,
            card_id: cardId,
            rating: "good",
            reviewed_at: iso(now - days * 86_400_000),
            duration_ms: 1_000,
            updated_at: iso(now - days * 86_400_000),
          })),
        )
      ).error,
    ).toBeNull();

    await page.goto(`/study?decks=${deckId}`);
    await expect(page.getByRole("group", { name: "앞면", exact: true })).toHaveText("lundi");
    const completion = page.getByRole("region", { name: "오늘 학습 완료", exact: true });
    await untilReacted(
      () => page.keyboard.press("ArrowRight"),
      async () => (await completion.count()) > 0,
    );
    await expect(completion.getByText("연속 3일", { exact: true })).toBeVisible();
  });
});

test("the shell's menu sits at the side from 1024 px and at the foot below it, a skip link leads to the content, and no page scrolls sideways", async ({
  page,
  context,
  baseURL,
}) => {
  if (!supabaseUrl || !supabaseKey || !baseURL) throw new Error("skipped above");
  const email = `web-shell-${randomUUID()}@example.com`;
  const password = "web-shell-password";
  const userId = await signUpInBrowser(context, baseURL, email, password);
  const phone = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  expect((await phone.auth.signInWithPassword({ email, password })).error).toBeNull();
  const deckId = randomUUID();
  const now = new Date().toISOString();
  expect(
    (
      await phone
        .from("decks")
        .insert({ id: deckId, user_id: userId, name: "French", created_at: now, updated_at: now })
    ).error,
  ).toBeNull();
  expect(
    (
      await phone.from("cards").insert({
        id: randomUUID(),
        user_id: userId,
        deck_id: deckId,
        front: [{ type: "text", payload: { text: "chat" } }],
        back: [{ type: "text", payload: { text: "cat" } }],
        card_key: "chat",
        source: "manual",
        created_at: now,
        updated_at: now,
      })
    ).error,
  ).toBeNull();

  // Both menus, the hidden one included, which a role query leaves out.
  const menus = page.locator('nav[aria-label="주 메뉴"]');
  for (const width of [1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const path of ["/", "/decks", `/decks/${deckId}`, "/record", "/account"]) {
      await page.goto(path);
      await expect(page.locator("h1")).toBeVisible();
      // One menu shows at a time: the side menu from 1024 px, the tab bar below.
      await expect(menus).toHaveCount(2);
      const [side, tabs] = [menus.first(), menus.last()];
      await expect(width >= 1024 ? side : tabs, `${path} at ${String(width)}`).toBeVisible();
      await expect(width >= 1024 ? tabs : side, `${path} at ${String(width)}`).toBeHidden();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect({ path, width, overflow }).toEqual({ path, width, overflow: 0 });
    }
  }

  // The skip link is the first stop, visible once focused, and leads past the menus.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/decks");
  await expect(page.locator("h1")).toBeVisible();
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "본문으로 건너뛰기", exact: true });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("searchbox", { name: "덱 검색" })).toBeFocused();
  // The landmarks: the menu, the content.
  await expect(page.getByRole("main")).toHaveCount(1);
  await page.goto("/record");
  await expect(page.getByRole("heading", { level: 1, name: "기록", exact: true })).toBeVisible();
  await shot(page, "12-record");
});

const url = process.env.E2E_SUPABASE_URL;
const key = process.env.E2E_SUPABASE_KEY;
test.skip(!url || !key, "needs a throwaway local Supabase stack; never calls extraction");

async function capture(page: Page, name: string) {
  const directory = process.env.E2E_SCREENSHOTS;
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: width < 1024 ? 844 : 900 });
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

test("creates a deck and a card on mobile, warns on a duplicate and keeps saved content", async ({
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
  const email = `web-authoring-${randomUUID()}@example.com`;
  const password = "web-authoring-test-password";
  const signup = await auth.auth.signUp({ email, password });
  expect(signup.error).toBeNull();
  const userId = signup.data.user?.id;
  if (!userId) throw new Error("sign-up returned no fixture user");
  expect(jar.size).toBeGreaterThan(0);
  await context.addCookies([...jar].map(([name, value]) => ({ name, value, url: baseURL })));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/decks");
  await expect(
    page.getByRole("heading", { name: "첫 덱을 만들어 볼까요?", exact: true }),
  ).toBeVisible();
  await capture(page, "authoring-empty");
  await untilReacted(
    () => page.getByRole("button", { name: "새 덱 만들기", exact: true }).click(),
    () => page.getByRole("dialog").isVisible(),
  );
  await page.getByRole("button", { name: "직접 입력", exact: true }).click();
  await page.getByRole("textbox", { name: "이름", exact: true }).fill("영어 단어");
  await page.getByRole("button", { name: "만들기", exact: true }).click();
  await expect(page.getByRole("heading", { name: "영어 단어", exact: true })).toBeVisible();
  await capture(page, "authoring-deck");
  await page.getByRole("button", { name: "카드 추가", exact: true }).click();
  await page.getByRole("button", { name: "직접 입력", exact: true }).click();
  await page.getByRole("textbox", { name: "앞면", exact: true }).fill("apple");
  await page.getByRole("textbox", { name: "뒷면", exact: true }).fill("사과");
  await capture(page, "authoring-direct");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "apple, 뒷면 가려짐", exact: true })).toBeVisible();
  const client = createClient(url, key, { auth: { persistSession: false } });
  expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull();
  const read = await client
    .from("cards")
    .select("id,front,back,template,template_version,card_key,revision")
    .eq("user_id", userId);
  expect(read.error).toBeNull();
  expect(read.data).toHaveLength(1);
  expect(read.data?.[0]).toMatchObject({
    template: "free",
    template_version: 2,
    card_key: "apple",
  });
  expect(Number(read.data?.[0]?.revision)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "카드 추가", exact: true }).click();
  await page.getByRole("button", { name: "직접 입력", exact: true }).click();
  await page.getByRole("textbox", { name: "앞면", exact: true }).fill("ＡPPLE");
  await page.getByRole("textbox", { name: "뒷면", exact: true }).fill("different");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(
    "이 덱에 이미 있는 카드예요",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "버리기", exact: true }).click();
  expect((await client.from("cards").select("id").eq("user_id", userId)).data).toHaveLength(1);
  await page.getByRole("button", { name: "카드 추가", exact: true }).click();
  await expect(page.getByLabel("앨범에서 고르기", { exact: true })).toBeAttached();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "카드 추가", exact: true })).toBeFocused();
});
