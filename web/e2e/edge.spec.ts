import { randomUUID } from "node:crypto";

import { type BrowserContext, expect, type Page, test } from "@playwright/test";
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

/** Whether [path] at [size] is a page the screen holds with the room for 말랑이: not a note's cards at any size, nor anything at 200%. */
const short = (path: string, size: string) => size !== "200%" && !path.startsWith("/decks/");

const sizes = [
  { width: 390, height: 844, name: "390" },
  { width: 1280, height: 900, name: "1280" },
  // 390 px at 200%: half the width and the height.
  { width: 195, height: 422, name: "200%" },
] as const;

/**
 * Signs up a fresh user, hands the browser its session, and gives it two notes: one of [cards]
 * cards and one of a single card.
 */
async function seed(context: BrowserContext, baseURL: string, cards = 3) {
  if (!url || !key) throw new Error("skipped without local stack");
  const jar = new Map<string, string>();
  const auth = createServerClient(url, key, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (written) => {
        for (const { name, value } of written) jar.set(name, value);
      },
    },
  });
  const email = `web-edge-${randomUUID()}@example.com`;
  const password = "web-edge-test-password";
  const signup = await auth.auth.signUp({ email, password });
  expect(signup.error).toBeNull();
  const userId = signup.data.user?.id;
  if (!userId) throw new Error("sign-up returned no fixture user");
  await context.addCookies([...jar].map(([name, value]) => ({ name, value, url: baseURL })));
  const db = createClient(url, key, { auth: { persistSession: false } });
  await db.auth.signInWithPassword({ email, password });
  const now = new Date().toISOString();
  const [first, second] = [randomUUID(), randomUUID()];
  expect(
    (
      await db.from("decks").insert([
        { id: first, user_id: userId, name: "영단어", created_at: now, updated_at: now },
        { id: second, user_id: userId, name: "표현", created_at: now, updated_at: now },
      ])
    ).error,
  ).toBeNull();
  const card = (deckId: string, word: string) => ({
    id: randomUUID(),
    user_id: userId,
    deck_id: deckId,
    front: [{ type: "text", payload: { text: word } }],
    back: [{ type: "text", payload: { text: `${word} 뜻` } }],
    card_key: word,
    source: "manual",
    created_at: now,
    updated_at: now,
  });
  expect(
    (
      await db
        .from("cards")
        .insert([
          ...Array.from({ length: cards }, (_, index) => card(first, `word${String(index)}`)),
          card(second, "hello"),
        ])
    ).error,
  ).toBeNull();
  return { first, second, userId, db };
}

const character = (page: Page) => page.getByRole("button", { name: /^말랑이와 대화하기/ });

/** Waits until the room under the last row is as high as the character's group and a gap. */
async function roomKept(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const button = [...document.querySelectorAll("button")].find((one) =>
          (one.getAttribute("aria-label") ?? "").startsWith("말랑이와 대화하기"),
        );
        const group = button?.parentElement;
        const room = group?.previousElementSibling;
        return group && room ? room.getBoundingClientRect().height - group.offsetHeight : null;
      }),
    )
    .toBe(24);
}

/**
 * Each control of the page the character's group overlaps, by tag and name, with the page
 * scrolled to its [place]: its top, or its end, where the room the page keeps under its last row
 * is what clears it.
 */
async function covered(page: Page, place: "top" | "end"): Promise<string[]> {
  return await page.evaluate((to) => {
    window.scrollTo(0, to === "top" ? 0 : document.documentElement.scrollHeight);
    const button = [...document.querySelectorAll("button")].find((one) =>
      (one.getAttribute("aria-label") ?? "").startsWith("말랑이와 대화하기"),
    );
    const group = button?.parentElement;
    if (!group) return ["the character is not drawn"];
    const box = group.getBoundingClientRect();
    return [
      ...document.querySelectorAll<HTMLElement>(
        'a[href], button, input:not([type="hidden"]), textarea, select, summary, [role="button"]',
      ),
    ].flatMap((element) => {
      if (group.contains(element)) return [];
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (rect.width <= 1 || rect.height <= 1 || style.visibility !== "visible") return [];
      const across = Math.min(rect.right, box.right) - Math.max(rect.left, box.left);
      const down = Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top);
      return across > 0.5 && down > 0.5
        ? [
            `${element.tagName} "${(element.getAttribute("aria-label") ?? element.textContent).trim().slice(0, 24)}"`,
          ]
        : [];
    });
  }, place);
}

/**
 * Saves [page] at 390 and 1280 px in both themes, and at 390 px shown at 200%, when
 * E2E_SCREENSHOTS names a directory; at every size nothing reaches past the viewport's right edge.
 */
async function capture(page: Page, name: string) {
  const directory = process.env.E2E_SCREENSHOTS;
  await page.addStyleTag({
    content: "*, *::before, *::after { transition: none !important; animation: none !important; }",
  });
  for (const { width, height, name: size } of sizes) {
    await page.setViewportSize({ width, height });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      // A resize that moves the page's scroll tucks the character, its event at the next frames;
      // it is drawn once it is out.
      await page.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
      );
      await expect(character(page).locator("span.block")).toHaveAttribute(
        "style",
        /translateX\(0px\)/,
      );
      expect(
        await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>("body *")]
            .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 0.5)
            .map((element) => `${element.tagName} ${element.className}`),
        ),
        `${name} at ${size} scrolls sideways`,
      ).toEqual([]);
      if (directory)
        await page.screenshot({
          path:
            size === "200%"
              ? `${directory}/200/${colorScheme}/web-${name}-390.png`
              : `${directory}/${colorScheme}/web-${name}-${String(width)}.png`,
        });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
}

test("draws 말랑이 on the 노트 page, a note and 기록 at 44 px or more, never over a control, and on no other screen", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("skipped without local stack");
  test.setTimeout(120_000);
  const { first } = await seed(context, baseURL);
  const pages = [
    {
      path: "/decks",
      name: "edge-notes",
      ready: page.getByRole("heading", { name: "노트", level: 1 }),
    },
    {
      path: `/decks/${first}`,
      name: "edge-note",
      ready: page.getByRole("heading", { name: "영단어", level: 1 }),
    },
    {
      path: "/record",
      name: "edge-record",
      ready: page.getByRole("heading", { name: "기록", level: 1 }),
    },
  ];
  for (const [index, { path, name, ready }] of pages.entries()) {
    await page.goto(path);
    await expect(ready).toBeVisible();
    await expect(character(page)).toBeVisible();
    // The first page it is drawn on carries the one-time hint, which is shown with the page.
    if (index === 0)
      await expect(page.getByText("말랑이를 누르면 언제든 대화할 수 있어요")).toBeVisible();
    for (const { width, height, name: size } of sizes) {
      await page.setViewportSize({ width, height });
      const box = await character(page).boundingBox();
      expect(box?.width, `${path} at ${size}`).toBeGreaterThanOrEqual(44);
      expect(box?.height, `${path} at ${size}`).toBeGreaterThanOrEqual(44);
      // At its end, the room under the last row clears it at every size. At its top, a page
      // longer than the screen has the character float over the rows it scrolls past, which is
      // why it tucks while the page scrolls; a short page is checked there too.
      await roomKept(page);
      expect(await covered(page, "end"), `${path} at ${size}, end`).toEqual([]);
      if (short(path, size))
        expect(await covered(page, "top"), `${path} at ${size}, top`).toEqual([]);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await capture(page, name);
  }

  // Control: the screens the owner left it off draw none, as 홈's own mascot is a link.
  for (const path of ["/", "/account", "/study"]) {
    await page.goto(path);
    await expect(page.locator("h1, main").first()).toBeVisible();
    await expect(character(page), path).toHaveCount(0);
  }
  // Nor the editor: it leaves the page while the card editor is open, and returns after it.
  await page.goto(`/decks/${first}`);
  await expect(character(page)).toBeVisible();
  await addByHand(page);
  await page.getByRole("button", { name: "직접 입력", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "새 카드" })).toBeVisible();
  await expect(character(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(character(page)).toBeVisible();
});

test("keeps its hint until it is closed, goes to the other edge by a drag and keeps it there, and tucks while the page scrolls", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("skipped without local stack");
  const { first } = await seed(context, baseURL, 24);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/decks/${first}`);
  const hint = page.getByText("말랑이를 누르면 언제든 대화할 수 있어요");
  await expect(hint).toBeVisible();
  await untilReacted(
    () => page.getByRole("button", { name: "안내 닫기" }).click(),
    () => hint.isHidden(),
  );
  await page.reload();
  await expect(character(page)).toBeVisible();
  await expect(hint, "closed for good, across a reload").toHaveCount(0);

  // At the right edge by default; a drag to the left puts it at the left, and a reload keeps it.
  // Where the drawing is, which the button's own box does not follow into the edge.
  const at = async () => (await character(page).locator("svg.mascot, img").boundingBox())?.x ?? -1;
  await expect.poll(at, { message: "at the right edge" }).toBeGreaterThan(195);
  const box = await character(page).boundingBox();
  if (!box) throw new Error("the character is drawn");
  await untilReacted(
    async () => {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(200, box.y + box.height / 2, { steps: 5 });
      await page.mouse.move(40, box.y + box.height / 2, { steps: 5 });
      await page.mouse.up();
    },
    async () => (await at()) < 195,
  );
  // The drag is not a tap: the chat is not opened.
  expect(new URL(page.url()).pathname).toBe(`/decks/${first}`);
  await page.reload();
  await expect(character(page)).toBeVisible();
  await expect.poll(at, { message: "kept at the left" }).toBeLessThan(195);

  // Tucked half into its edge while the page scrolls, and out again once it stops.
  const left = await at();
  await page.mouse.wheel(0, 600);
  await expect.poll(at, { message: "tucked" }).toBeLessThan(left - 20);
  await expect.poll(at, { message: "back out", timeout: 3_000 }).toBe(left);
});

test("breathes and blinks, and holds still under reduced motion", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("skipped without local stack");
  await seed(context, baseURL);
  await page.goto("/decks");
  const drawing = character(page).locator("svg.mascot");
  await expect(drawing).toHaveAttribute("data-motion", "full");
  // Control: the same page under reduced motion draws the still image, which moves nothing.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(drawing).toHaveCount(0);
  await expect(character(page).locator("img")).toBeVisible();
});

test("shows the cards ready in a short bubble, and opens the chat from the note, naming it", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("skipped without local stack");
  const { first } = await seed(context, baseURL);
  const proposal = {
    id: "p1",
    kind: "cards",
    deck: { id: null, name: "영단어 2" },
    groups: [
      {
        id: "g1",
        title: "1단원",
        format: "text",
        cards: ["a", "b"].map((id) => ({ id, card: { front: id, back: id } })),
      },
    ],
  };
  await page.addInitScript(
    (kept) => {
      window.localStorage.setItem("knowno.assistant", JSON.stringify(kept));
    },
    {
      version: 1,
      draft: "",
      turns: [
        {
          role: "assistant",
          id: "a1",
          text: "만들었어요",
          citations: [],
          proposals: [{ proposal, checked: { g1: ["a", "b"] }, added: null }],
          choice: null,
          job: null,
          ending: "ok",
        },
      ],
    },
  );
  const sent: unknown[] = [];
  await page.route("**/api/assistant", async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: 'event: text\ndata: {"delta":"네"}\n\n',
    });
  });
  await page.goto(`/decks/${first}`);
  await expect(
    page.getByRole("button", { name: "말랑이와 대화하기, 2장 만들어 뒀어요" }),
  ).toBeVisible();
  await expect(page.getByText("2장 만들어 뒀어요", { exact: true })).toBeVisible();
  // Control: the 홈 bubble's longer words are 홈's alone.
  await expect(page.getByText("카드 2장 만들어 뒀어요")).toHaveCount(0);

  await untilReacted(
    () => character(page).click(),
    () => page.getByRole("heading", { name: "말랑이", level: 1 }).isVisible(),
  );
  expect(new URL(page.url()).search).toBe(`?note=${first}`);
  await expect(page.getByText("영단어 노트에서")).toBeVisible();
  const field = page.getByRole("textbox", { name: "말랑이에게 보낼 메시지" });
  await field.fill("카드 더 만들어 줘");
  await page.getByRole("button", { name: "보내기" }).click();
  await expect(page.getByText("네", { exact: true })).toBeVisible();
  expect(sent).toHaveLength(1);
  expect((sent[0] as { context: unknown }).context).toEqual({ deck_id: first });
});
