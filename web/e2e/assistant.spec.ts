import { randomUUID } from "node:crypto";

import { type BrowserContext, expect, type Page, test } from "@playwright/test";
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

/** Signs a fresh account up into [context], and returns a client signed in as it. */
async function signUp(context: BrowserContext, baseURL: string) {
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
  const email = `web-assistant-${randomUUID()}@example.com`;
  const password = "web-assistant-test-password";
  const signup = await auth.auth.signUp({ email, password });
  expect(signup.error).toBeNull();
  const userId = signup.data.user?.id;
  if (!userId) throw new Error("sign-up returned no fixture user");
  await context.addCookies(
    [...jar].map(([cookie, value]) => ({ name: cookie, value, url: baseURL })),
  );
  const db = createClient(url, key, { auth: { persistSession: false } });
  await db.auth.signInWithPassword({ email, password });
  return { db, userId };
}

/** A stream of the function's events, as `/api/assistant` passes it on. */
const events = (...list: [string, object][]) =>
  list.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("");

const usage = (tokensUsed: number) =>
  ["usage", { outcome: "ok", token_budget: 200000, tokens_used: tokensUsed }] as [string, object];

const cards = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `${prefix}${String(index)}`,
    card: {
      blocks: [
        {
          type: "senses",
          term: `word ${prefix}${String(index)}`,
          senses: [{ labels: ["명"], meaning: `뜻 ${String(index)}` }],
        },
      ],
    },
  }));

const proposal = {
  id: "p1",
  kind: "cards",
  deck: { id: null, name: "영단어 1단원" },
  groups: [
    { id: "g1", title: "1단원 단어", format: "senses", cards: cards("a", 3) },
    { id: "g2", title: "1단원 표현", format: "senses", cards: cards("b", 8) },
  ],
};

/**
 * Stands a stub in for the assistant route: each message the page sends is answered by the next of
 * [answers], an event stream or a refusal's status and body; returns the bodies the page sent.
 */
async function stubAssistant(
  page: Page,
  answers: ({ events: string } | { status: number; body: object })[],
) {
  const sent: unknown[] = [];
  await page.route("**/api/assistant", async (route) => {
    sent.push(route.request().postDataJSON());
    const answer = answers.shift();
    if (!answer) throw new Error("no answer left for /api/assistant");
    await ("events" in answer
      ? route.fulfill({ status: 200, contentType: "text/event-stream", body: answer.events })
      : route.fulfill({ status: answer.status, json: answer.body }));
  });
  return sent;
}

/**
 * Saves [page] at 390 and 1280 px in both themes, and at 390 px shown at 200%, when E2E_SCREENSHOTS
 * names a directory; at every size nothing reaches past the viewport's right edge, a table or code block
 * wider than its bubble scrolling inside it.
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
      expect(
        await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>("body *")]
            // A table or a code block wider than its bubble scrolls inside it, and its cells are clipped there.
            .filter((element) => element.closest('[role="region"][aria-label="표"], pre') === null)
            .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 0.5)
            .map((element) => `${element.tagName} ${element.className}`),
        ),
        `${name} at ${String(width)} scrolls sideways`,
      ).toEqual([]);
      if (directory)
        await page.screenshot({
          path:
            zoom === 1
              ? `${directory}/${colorScheme}/web-${name}-${String(width)}.png`
              : `${directory}/200/${colorScheme}/web-${name}-390.png`,
        });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
}

const field = (page: Page) => page.getByRole("textbox", { name: "말랑이에게 보낼 메시지" });

async function say(page: Page, text: string) {
  await field(page).fill(text);
  await page.getByRole("button", { name: "보내기" }).click();
}

test("opens 말랑이 from 홈's first run, streams its reply, asks, proposes in groups with checks, and says when the day is used", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("E2E_BASE_URL is unset");
  await signUp(context, baseURL);
  const sent = await stubAssistant(page, [
    {
      events: events(
        ["text", { delta: "좋아요. 어떤 형식으로 만들까요?" }],
        ["choice", { prompt: "형식", options: ["단어", "빈칸 문장", "표", "알아서 섞어서"] }],
        usage(20000),
      ),
    },
    {
      events: events(
        ["text", { delta: "1단원을 두 묶음으로 만들었어요. 뺄 카드는 체크를 풀어 주세요." }],
        ["citation", { url: "https://example.com/unit-1", title: "1단원 단어표" }],
        ["proposal", proposal],
        usage(72000),
      ),
    },
    { status: 429, body: { error: "rate_limited", token_budget: 200000, tokens_used: 200400 } },
  ]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await capture(page, "home-first-run");
  const primary = page.getByRole("link", { name: "말랑이와 첫 노트 만들기", exact: true });
  await untilReacted(
    () => primary.click(),
    () => Promise.resolve(page.url().endsWith("/assistant")),
  );
  await expect(page.getByText("무엇을 외워 볼까요?")).toBeVisible();
  await capture(page, "assistant-empty");

  await say(page, "영단어 1단원 카드 만들어 줘");
  await expect(page.getByText("좋아요. 어떤 형식으로 만들까요?")).toBeVisible();
  await expect(page.getByText("오늘 90% 남았어요")).toBeVisible();
  await capture(page, "assistant-choice");

  await page.getByRole("group", { name: "형식" }).getByRole("button", { name: "단어" }).click();
  const add = page.getByRole("button", { name: "11장 추가", exact: true });
  await expect(add).toBeVisible();
  expect(sent[1]).toMatchObject({
    messages: [
      { role: "user", text: "영단어 1단원 카드 만들어 줘" },
      { role: "assistant", choice: { prompt: "형식" } },
      { role: "user", text: "단어" },
    ],
  });
  // The larger group starts collapsed to its count and form.
  await expect(page.getByRole("button", { name: "카드 8장 · 단어" })).toBeVisible();
  await page.getByRole("checkbox", { name: /word a1/ }).uncheck();
  await expect(page.getByRole("button", { name: "10장 추가", exact: true })).toBeVisible();
  await expect(page.getByText("오늘 64% 남았어요")).toBeVisible();
  await capture(page, "assistant-proposal");

  await say(page, "하나 더 만들어 줘");
  // By its words: Next.js's route announcer is an alert too.
  await expect(
    page.getByText("오늘 말랑이와 이야기할 수 있는 만큼 다 썼어요. 내일 다시 이야기해요."),
  ).toHaveRole("alert");
  await expect(field(page)).toHaveCount(0);
  await capture(page, "assistant-rate-limited");
});

test("goes from a note 말랑이 wrote back to the same chat, its scroll and draft kept, and shows 홈's bubble while cards wait", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("E2E_BASE_URL is unset");
  const { db, userId } = await signUp(context, baseURL);
  const deckId = randomUUID();
  const time = new Date().toISOString();
  const deck = await db.from("decks").insert({
    id: deckId,
    user_id: userId,
    name: "영단어 1단원",
    visibility: "private",
    created_at: time,
    updated_at: time,
  });
  expect(deck.error).toBeNull();
  const reply = (id: string, text: string, proposals: object[]) => ({
    role: "assistant",
    id,
    text,
    citations: [],
    choice: null,
    ending: "ok",
    proposals,
  });
  const many = Array.from({ length: 12 }, (_, index) => [
    { role: "user", id: `u${String(index)}`, text: `질문 ${String(index)}` },
    reply(`r${String(index)}`, `답 ${String(index)} `.repeat(30), []),
  ]).flat();
  const added = {
    proposal: { ...proposal, deck: { id: deckId, name: "영단어 1단원" } },
    checked: { g1: ["a0", "a1", "a2"], g2: [] },
    added: { deck: { id: deckId, name: "영단어 1단원" }, count: 3 },
  };
  const ready = {
    ...added,
    added: null,
    checked: { g1: ["a0", "a1", "a2"], g2: cards("b", 8).map((card) => card.id) },
  };
  await page.goto("/");
  await page.evaluate(
    (stored) => {
      window.localStorage.setItem("knowno.assistant", stored);
    },
    JSON.stringify({
      version: 1,
      draft: "",
      // The note's shortcut mid-list, so the place kept is not the list's end.
      turns: [...many.slice(0, 12), reply("added", "3장을 넣었어요.", [added]), ...many.slice(12)],
    }),
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/assistant");
  const shortcut = page.getByRole("link", { name: /영단어 1단원.*카드 3장/ });
  await shortcut.scrollIntoViewIfNeeded();
  await capture(page, "assistant-added");
  await shortcut.scrollIntoViewIfNeeded();
  await field(page).fill("다음 단원도");
  const list = page.locator("ol[aria-label='대화']").locator("..");
  const kept = await list.evaluate((element) => element.scrollTop);
  // Control: the place is the reader's, not the list's end the chat opens at.
  expect(kept).toBeLessThan(
    (await list.evaluate((element) => element.scrollHeight - element.clientHeight)) - 100,
  );
  await expect
    .poll(() => page.evaluate(() => window.sessionStorage.getItem("knowno.assistant.scroll")))
    .toBe(String(kept));
  await shortcut.click();
  await expect(page).toHaveURL(new RegExp(`/decks/${deckId}$`));
  await page.goBack();
  await expect(field(page)).toHaveValue("다음 단원도");
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBe(kept);

  // A proposal not yet added: 홈's mascot says how many cards wait.
  await page.evaluate(
    (stored) => {
      window.localStorage.setItem("knowno.assistant", stored);
    },
    JSON.stringify({ version: 1, draft: "", turns: [reply("ready", "만들어 뒀어요.", [ready])] }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: /^말랑이와 대화하기.*카드 11장 만들어 뒀어요$/ }),
  ).toBeVisible();
  await capture(page, "home-bubble");
});

test("attaches photos, stores them for the function, shows the job reading them and goes on by itself once it is read", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("E2E_BASE_URL is unset");
  test.setTimeout(60_000);
  const { db, userId } = await signUp(context, baseURL);
  const sent = await stubAssistant(page, [
    {
      events: events(
        ["text", { delta: "사진 두 장을 읽고 있어요." }],
        ["job", { id: "0190a7c2-3b4d-7e5f-8a9b-0c1d2e3f4a5b", photos: 2, status: "running" }],
        usage(10000),
      ),
    },
    { events: events(["text", { delta: "다 읽었어요. 카드로 만들게요." }], usage(30000)) },
  ]);
  // The function's poll: one photo read, then both.
  const polls = [1, 2];
  await page.route("**/api/assistant/jobs/*", async (route) => {
    const finished = polls.shift() ?? 2;
    await route.fulfill({
      json: {
        id: "0190a7c2-3b4d-7e5f-8a9b-0c1d2e3f4a5b",
        status: finished === 2 ? "done" : "running",
        photos: [0, 1].map((position) => ({
          position,
          photo_id: `p${String(position)}`,
          status: position < finished ? "read" : "queued",
        })),
      },
    });
  });
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/assistant");
  await expect(field(page)).toBeVisible();
  const attach = page.getByLabel("사진 첨부");
  await untilReacted(
    () =>
      attach.setInputFiles([
        { name: "a.png", mimeType: "image/png", buffer: png },
        { name: "b.png", mimeType: "image/png", buffer: png },
      ]),
    () => page.getByRole("list", { name: "사진 2장" }).isVisible(),
  );
  await capture(page, "assistant-photos-staged");
  await field(page).fill("이 사진들로 카드 만들어 줘");
  await page.getByRole("button", { name: "보내기" }).click();
  await expect(page.getByText("0/2장 읽는 중")).toBeVisible();
  await capture(page, "assistant-photo-job");

  // Each photo is in the private bucket under the user's folder, named as the message names it.
  const [first] = sent;
  const ids = (first as { messages: { photos: string[] }[] }).messages[0]?.photos ?? [];
  expect(ids).toHaveLength(2);
  const stored = await db.storage.from("assistant-photos").list(userId);
  expect(stored.data?.map((object) => object.name).sort()).toEqual([...ids].sort());

  await expect(page.getByText("1/2장 읽는 중")).toBeVisible();
  await expect(page.getByText("사진 2장을 다 읽었어요")).toBeVisible();
  await expect(page.getByText("다 읽었어요. 카드로 만들게요.")).toBeVisible();
  expect(sent[1]).toMatchObject({
    messages: [
      { role: "user", photos: ids },
      { role: "assistant", job: { id: "0190a7c2-3b4d-7e5f-8a9b-0c1d2e3f4a5b", photos: 2 } },
      { role: "user", text: "사진 읽기가 끝났어요. 이어서 해 주세요." },
    ],
  });
  // That turn is the chat's own and is not drawn.
  await expect(page.getByText("사진 읽기가 끝났어요. 이어서 해 주세요.")).toHaveCount(0);
  await capture(page, "assistant-photos-done");
});

test("draws a Markdown reply in a bubble in both themes, its wide table scrolling inside it and its link opening a new tab", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("E2E_BASE_URL is unset");
  await signUp(context, baseURL);
  const wide = `| ${Array.from({ length: 12 }, (_, index) => `열 ${String(index)} 아주 긴 제목`).join(" | ")} |`;
  const rule = `| ${Array.from({ length: 12 }, () => "---").join(" | ")} |`;
  const row = `| ${Array.from({ length: 12 }, (_, index) => `값 ${String(index)}`).join(" | ")} |`;
  await stubAssistant(page, [
    {
      events: events(
        [
          "text",
          {
            delta: [
              "## 정리",
              "",
              "**굵게** 그리고 `코드`, [문서](https://example.com/doc)",
              "",
              "- 하나",
              "  - 안쪽",
              "",
              wide,
              rule,
              row,
            ].join("\n"),
          },
        ],
        usage(20000),
      ),
    },
  ]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/assistant");
  await expect(field(page)).toBeVisible();
  await say(page, "정리해 줘");
  await expect(page.getByRole("columnheader", { name: "열 0 아주 긴 제목" })).toBeAttached();
  const link = page.getByRole("link", { name: "문서" });
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");

  const region = page.getByRole("region", { name: "표" });
  const bubble = page.locator("li", { has: region }).locator("> div").first();
  // The table is wider than its bubble and scrolls there, the page not at all.
  const sizes = await region.evaluate((element) => ({
    scroll: element.scrollWidth,
    client: element.clientWidth,
    overflowX: getComputedStyle(element).overflowX,
    regionRight: element.getBoundingClientRect().right,
    bubbleRight: element.parentElement?.getBoundingClientRect().right ?? Infinity,
    window: window.innerWidth,
  }));
  expect(sizes.scroll).toBeGreaterThan(sizes.client);
  expect(sizes.overflowX).toBe("auto");
  expect(sizes.regionRight).toBeLessThanOrEqual(sizes.bubbleRight);
  expect(sizes.bubbleRight).toBeLessThanOrEqual(sizes.window);

  // The bubble is the surface under the hairline, in each theme, and not the ground behind it.
  const paint = (colorScheme: "light" | "dark") =>
    page.emulateMedia({ colorScheme }).then(() =>
      bubble.evaluate((element) => ({
        bubble: getComputedStyle(element).backgroundColor,
        ground: getComputedStyle(document.body).backgroundColor,
        text: getComputedStyle(element).color,
      })),
    );
  const light = await paint("light");
  const dark = await paint("dark");
  // theme.md's surface: #FFFFFF light, #232F4E dark.
  expect(light.bubble).toBe("rgb(255, 255, 255)");
  expect(dark.bubble).toBe("rgb(35, 47, 78)");
  expect(light.bubble).not.toBe(light.ground);
  expect(dark.bubble).not.toBe(dark.ground);
  expect(light.bubble).not.toBe(dark.bubble);
  expect(light.text).not.toBe(dark.text);
  await capture(page, "assistant-markdown");
});

test("shows the typing dots from the send, while the route has not answered, until the reply's first text", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("E2E_BASE_URL is unset");
  await signUp(context, baseURL);
  let answer: () => void = () => undefined;
  const answered = new Promise<void>((resolve) => {
    answer = resolve;
  });
  await page.route("**/api/assistant", async (route) => {
    await answered;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: events(["text", { delta: "네, 해 볼게요." }], usage(20000)),
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/assistant");
  await expect(page.getByText("무엇을 외워 볼까요?")).toBeVisible();
  await say(page, "안녕");
  const typing = page.getByRole("status").filter({ hasText: "말랑이가 생각하는 중이에요" });
  await expect(typing).toBeVisible();
  // The bar draws no mascot; the profile beside the dots is the chat's only one.
  const title = page.getByRole("heading", { name: "말랑이", exact: true });
  await expect(title).toBeVisible();
  await expect(title.locator("xpath=ancestor::header").locator("img")).toHaveCount(0);
  await expect(page.locator("ol[aria-label='대화'] img")).toHaveCount(1);
  answer();
  await expect(page.getByText("네, 해 볼게요.")).toBeVisible();
  await expect(typing).toHaveCount(0);
});
