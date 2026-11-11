import { randomUUID } from "node:crypto";

import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

import { database, runSql } from "./database";
import { untilReacted } from "./until-reacted";

// The local stack scripts/test-web.ts starts, whose URL and publishable key the app was built with.
const url = process.env.E2E_SUPABASE_URL;
const key = process.env.E2E_SUPABASE_KEY;
test.skip(
  !url || !key || !database,
  "needs a throwaway local Supabase stack, which sets E2E_SUPABASE_URL, E2E_SUPABASE_KEY and E2E_DB_CONTAINER",
);

/** Saves [page] at 390 and 1280 px in both themes when E2E_SCREENSHOTS names a directory. */
async function capture(page: Page, name: string) {
  const directory = process.env.E2E_SCREENSHOTS;
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; }" });
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      if (directory)
        await page.screenshot({
          path: `${directory}/${colorScheme}/web-note-settings-${name}-${String(width)}.png`,
        });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
}

/** Opens 노트 설정 and picks [item], once the page has hydrated enough to open the menu. */
async function choose(page: Page, item: string) {
  await untilReacted(
    () => page.getByRole("button", { name: "노트 설정" }).click(),
    () => page.getByRole("menu", { name: "노트 설정" }).isVisible(),
  );
  await page.getByRole("menuitem", { name: item, exact: true }).click();
}

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
  const email = `web-note-settings-${randomUUID()}@example.com`;
  const password = "web-note-settings-test-password";
  const signup = await auth.auth.signUp({ email, password });
  expect(signup.error).toBeNull();
  const userId = signup.data.user?.id;
  if (!userId) throw new Error("sign-up returned no fixture user");
  await context.addCookies([...jar].map(([name, value]) => ({ name, value, url: baseURL })));
  const db = createClient(url, key, { auth: { persistSession: false } });
  await db.auth.signInWithPassword({ email, password });
  return { db, userId };
}

test("renames, decorates, publishes, makes private and deletes a note as the user, under row-level security", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("skipped without local stack");
  const { db, userId } = await signUp(context, baseURL);
  const deckId = randomUUID();
  const otherId = randomUUID();
  const time = new Date(Date.now() - 86_400_000).toISOString();
  const decks = await db.from("decks").insert(
    [
      [deckId, "French"],
      [otherId, "Kept"],
    ].map(([id, name]) => ({
      id,
      user_id: userId,
      name,
      visibility: "private",
      created_at: time,
      updated_at: time,
    })),
  );
  expect(decks.error).toBeNull();
  const card = (deck: string, front: string) => ({
    id: randomUUID(),
    deck_id: deck,
    user_id: userId,
    front: [{ type: "text", v: 3, id: "f", payload: { front, back: "" } }],
    back: [],
    card_key: front,
    source: "manual",
    template: "free",
    template_version: 2,
    created_at: time,
    updated_at: time,
  });
  const cards = await db
    .from("cards")
    .insert([card(deckId, "chat"), card(deckId, "chien"), card(otherId, "kept")]);
  expect(cards.error).toBeNull();
  const stored = async () =>
    (
      await db
        .from("decks")
        .select("name, icon, color, visibility, description, deleted_at")
        .eq("id", deckId)
        .single()
    ).data;

  await page.goto(`/decks/${deckId}`);
  await untilReacted(
    () => page.getByRole("button", { name: "노트 설정" }).click(),
    () => page.getByRole("menu", { name: "노트 설정" }).isVisible(),
  );
  await capture(page, "menu");
  await page.keyboard.press("Escape");

  // 이름 바꾸기, its sheet holding a history entry the browser's back closes.
  await choose(page, "이름 바꾸기");
  const rename = page.getByRole("dialog", { name: "노트 이름 바꾸기" });
  await expect(rename).toBeVisible();
  await page.goBack();
  await expect(rename).toBeHidden();
  await expect(page).toHaveURL(`${baseURL}/decks/${deckId}`);
  await choose(page, "이름 바꾸기");
  await rename.getByRole("textbox", { name: "노트 이름" }).fill("Français");
  await rename.getByRole("button", { name: "저장", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Français", exact: true }),
  ).toBeVisible();
  expect(await stored()).toMatchObject({ name: "Français" });

  // 노트 꾸미기's icon and colour.
  await choose(page, "노트 꾸미기");
  const decorate = page.getByRole("dialog", { name: "노트 꾸미기" });
  // Each radio is visually hidden inside its choice, which takes the pointer.
  await decorate.getByRole("radio", { name: "별" }).check({ force: true });
  await decorate.getByRole("radio", { name: "모래" }).check({ force: true });
  await capture(page, "decorate");
  await decorate.getByRole("button", { name: "저장", exact: true }).click();
  await expect(decorate).toBeHidden();
  expect(await stored()).toMatchObject({ icon: "star", color: "sand" });

  // 노트 공개, asking for the display name the first time.
  await choose(page, "노트 공개");
  const publish = page.getByRole("dialog", { name: '"Français" 공개' });
  await publish.getByRole("textbox", { name: "공개 이름" }).fill("가람");
  await publish.getByRole("textbox", { name: "설명 (선택)" }).fill("고양이와 개");
  await publish.getByRole("checkbox").check();
  await capture(page, "publish");
  // The stack runs no Edge runtime, so publish-note is substituted at the Server Action: the
  // action reaches the built app and finds no function, so it answers a failure and writes no
  // visibility, which the stand-in reads back; then the database makes the note public as the
  // function's request and screening would, and the action's answer is replaced by its success.
  let publishedAs: unknown;
  await page.route("**/decks/**", async (route) => {
    const request = route.request();
    if (
      request.method() !== "POST" ||
      !request.headers()["next-action"] ||
      !request.postData()?.includes("고양이와 개")
    ) {
      await route.fallback();
      return;
    }
    const response = await route.fetch();
    const body = await response.text();
    expect(body).toContain('"saved":false');
    publishedAs = await stored();
    runSql(
      `update public.decks set visibility = 'public', published_at = now(), description = '고양이와 개' where id = '${deckId}'`,
    );
    await route.fulfill({ response, body: body.replace('"saved":false', '"saved":true') });
  });
  await publish.getByRole("button", { name: "공개", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("노트를 공개했어요");
  expect(publishedAs).toMatchObject({ visibility: "private" });
  expect(await stored()).toMatchObject({ visibility: "public", description: "고양이와 개" });
  await page.unroute("**/decks/**");
  await page.reload();
  await expect(page.getByText("0장 익힘 · 공개", { exact: true })).toBeVisible();
  const profile = await db.from("profiles").select("display_name").eq("user_id", userId).single();
  expect(profile.data).toEqual({ display_name: "가람" });

  await choose(page, "비공개로 전환");
  await expect(page.getByRole("status")).toHaveText("노트를 비공개로 전환했어요");
  await expect(page.getByText("0장 익힘", { exact: true })).toBeVisible();
  expect(await stored()).toMatchObject({ visibility: "private", description: "고양이와 개" });

  // 노트 삭제 asks, then tombstones the note and its cards and opens the 노트 page.
  await choose(page, "노트 삭제");
  const question = page.getByRole("dialog", { name: '"Français" 노트를 삭제할까요?' });
  await expect(question).toContainText("카드 2장도 함께 삭제돼요.");
  await capture(page, "delete");
  await question.getByRole("button", { name: "삭제", exact: true }).click();
  await expect(page).toHaveURL(`${baseURL}/decks`);
  // A row's name carries its counts after the note's; Next's route announcer may still read the
  // deleted note's heading, so the rows are what is asserted.
  await expect(page.getByRole("link", { name: /^Kept, / })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Français, / })).toHaveCount(0);
  const deleted = await stored();
  expect(deleted?.deleted_at).not.toBeNull();
  const left = await db.from("cards").select("deck_id, deleted_at").eq("user_id", userId);
  const tombstones = (deck: string): unknown[] =>
    (left.data ?? []).filter((row) => row.deck_id === deck).map((row): unknown => row.deleted_at);
  expect(tombstones(deckId)).toEqual([deleted?.deleted_at, deleted?.deleted_at]);
  expect(tombstones(otherId)).toEqual([null]);
});

/** A 1×1 PNG, which 노트 꾸미기 crops and encodes as a JPEG in the browser. */
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);

test("stores a note's photo in Storage, draws it on the 노트 page from a signed URL, releases the one it replaces and the last one with the note", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("skipped without local stack");
  const { db, userId } = await signUp(context, baseURL);
  const deckId = randomUUID();
  const time = new Date(Date.now() - 86_400_000).toISOString();
  const deck = await db.from("decks").insert({
    id: deckId,
    user_id: userId,
    name: "Photo",
    visibility: "private",
    created_at: time,
    updated_at: time,
  });
  expect(deck.error).toBeNull();
  /** The deck's stored image id. */
  const image = async (): Promise<string> => {
    const read = await db.from("decks").select("image_media_id").eq("id", deckId).single();
    const id: unknown = read.data?.image_media_id;
    if (typeof id !== "string") throw new Error("the note holds no photo");
    return id;
  };
  /** Whether Storage holds the user's object [id], read as the user. */
  const held = async (id: string) =>
    (await db.storage.from("media").download(`${userId}/${id}`)).error === null;
  /** The ids of the user's `media` rows. */
  const rows = async (): Promise<unknown[]> =>
    ((await db.from("media").select("id")).data ?? []).map((row): unknown => row.id);

  /** Picks the PNG in 노트 꾸미기 through [picker], "다른 사진" once the note has one, and saves it. */
  async function savePhoto(picker = "앨범에서 고르기") {
    await choose(page, "노트 꾸미기");
    const decorate = page.getByRole("dialog", { name: "노트 꾸미기" });
    await decorate
      .getByLabel(picker, { exact: true })
      .setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: png });
    await expect(decorate.getByRole("button", { name: "사진 삭제", exact: true })).toBeVisible();
    await decorate.getByRole("button", { name: "저장", exact: true }).click();
    await expect(decorate).toBeHidden();
  }

  await page.goto(`/decks/${deckId}`);
  await savePhoto();
  const first = await image();
  expect(await held(first)).toBe(true);
  expect(await rows()).toEqual([first]);

  // 노트 draws it from a URL Storage signed for the user, which the browser can read.
  await page.goto("/decks");
  const photo = page.getByRole("link", { name: /^Photo, / }).locator("[style*='background-image']");
  const style = (await photo.getAttribute("style")) ?? "";
  expect(style).toContain(`/storage/v1/object/sign/media/${userId}/${first}?token=`);
  const signed = /url\("([^"]+)"\)/.exec(style)?.[1] ?? "";
  const fetched = await page.request.get(signed);
  expect(fetched.status()).toBe(200);
  expect(fetched.headers()["content-type"]).toBe("image/jpeg");

  // A new photo replaces it: the old object and row go, and the new one is readable.
  await page.goto(`/decks/${deckId}`);
  await savePhoto("다른 사진");
  const second = await image();
  expect(second).not.toBe(first);
  expect(await held(first)).toBe(false);
  expect(await held(second)).toBe(true);
  expect(await rows()).toEqual([second]);

  // Deleting the note releases its photo, which nothing else holds.
  await choose(page, "노트 삭제");
  await page
    .getByRole("dialog", { name: '"Photo" 노트를 삭제할까요?' })
    .getByRole("button", { name: "삭제", exact: true })
    .click();
  await expect(page).toHaveURL(`${baseURL}/decks`);
  await expect.poll(() => held(second)).toBe(false);
  expect(await rows()).toEqual([]);
});

test("shows a note the server is still checking as waiting, never as public, and offers no second publish", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("skipped without local stack");
  const { db, userId } = await signUp(context, baseURL);
  const deckId = randomUUID();
  const time = new Date(Date.now() - 86_400_000).toISOString();
  const deck = await db.from("decks").insert({
    id: deckId,
    user_id: userId,
    name: "Waiting",
    visibility: "private",
    created_at: time,
    updated_at: time,
  });
  expect(deck.error).toBeNull();
  const card = await db.from("cards").insert({
    id: randomUUID(),
    deck_id: deckId,
    user_id: userId,
    front: [{ type: "text", v: 3, id: "f", payload: { front: "chat", back: "" } }],
    back: [],
    card_key: "chat",
    source: "manual",
    template: "free",
    template_version: 2,
    created_at: time,
    updated_at: time,
  });
  expect(card.error).toBeNull();
  await db.from("profiles").upsert({ display_name: "가람" }, { onConflict: "user_id" });

  await page.goto(`/decks/${deckId}`);
  await choose(page, "노트 공개");
  const publish = page.getByRole("dialog", { name: '"Waiting" 공개' });
  await publish.getByRole("checkbox").check();
  // As the stand-in above, the stack runs no Edge runtime: the database leaves the note held, as
  // the screening of a flagged note does, and the action's answer is replaced by the waiting one
  // publish-note gives for it.
  await page.route("**/decks/**", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !request.headers()["next-action"]) {
      await route.fallback();
      return;
    }
    const response = await route.fetch();
    const body = await response.text();
    expect(body).toContain('"saved":false');
    runSql(
      `update public.decks set visibility = 'public', hidden = true, publication = 'held', published_at = now() where id = '${deckId}'`,
    );
    await route.fulfill({
      response,
      body: body.replace(
        /\{"saved":false[^}]*\}/u,
        '{"saved":false,"message":"노트를 확인하고 있어요. 확인이 끝나면 공개돼요.","waiting":true}',
      ),
    });
  });
  await publish.getByRole("button", { name: "공개", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(
    "노트를 확인하고 있어요. 확인이 끝나면 공개돼요.",
  );
  await page.unroute("**/decks/**");
  await page.getByRole("button", { name: "확인", exact: true }).click();
  await page.reload();
  await expect(page.getByText("0장 익힘 · 확인 중", { exact: true })).toBeVisible();
  await expect(page.getByText("0장 익힘 · 공개", { exact: true })).toHaveCount(0);
  await untilReacted(
    () => page.getByRole("button", { name: "노트 설정" }).click(),
    () => page.getByRole("menu", { name: "노트 설정" }).isVisible(),
  );
  await expect(page.getByRole("menuitem", { name: "노트 공개", exact: true })).toHaveCount(0);
});
