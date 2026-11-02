import { randomUUID } from "node:crypto";

import { expect, type Page, test } from "@playwright/test";
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

test("renames, decorates, publishes, makes private and deletes a note as the user, under row-level security", async ({
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
  const email = `web-note-settings-${randomUUID()}@example.com`;
  const password = "web-note-settings-test-password";
  const signup = await auth.auth.signUp({ email, password });
  expect(signup.error).toBeNull();
  const userId = signup.data.user?.id;
  if (!userId) throw new Error("sign-up returned no fixture user");
  await context.addCookies([...jar].map(([name, value]) => ({ name, value, url: baseURL })));
  const db = createClient(url, key, { auth: { persistSession: false } });
  await db.auth.signInWithPassword({ email, password });

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
    front: [{ type: "text", v: 1, id: "f", payload: { text: front } }],
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
  await decorate.getByRole("radio", { name: "별" }).check();
  await decorate.getByRole("radio", { name: "모래" }).check();
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
  await publish.getByRole("button", { name: "공개", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("노트를 공개했어요");
  await expect(page.getByText("0장 익힘 · 공개", { exact: true })).toBeVisible();
  expect(await stored()).toMatchObject({ visibility: "public", description: "고양이와 개" });
  const profile = await db.from("profiles").select("display_name").eq("user_id", userId).single();
  expect(profile.data).toEqual({ display_name: "가람" });

  await choose(page, "비공개로 전환");
  await expect(page.getByRole("status")).toHaveText("노트를 비공개로 전환했어요");
  expect(await stored()).toMatchObject({ visibility: "private", description: "고양이와 개" });

  // 노트 삭제 asks, then tombstones the note and its cards and opens 홈.
  await choose(page, "노트 삭제");
  const question = page.getByRole("dialog", { name: '"Français" 노트를 삭제할까요?' });
  await expect(question).toContainText("카드 2장도 함께 삭제돼요.");
  await capture(page, "delete");
  await question.getByRole("button", { name: "삭제", exact: true }).click();
  await expect(page).toHaveURL(`${baseURL}/`);
  await expect(page.getByText("Kept")).toBeVisible();
  await expect(page.getByText("Français")).toHaveCount(0);
  const deleted = await stored();
  expect(deleted?.deleted_at).not.toBeNull();
  const left = await db.from("cards").select("deck_id, deleted_at").eq("user_id", userId);
  const tombstones = (deck: string): unknown[] =>
    (left.data ?? []).filter((row) => row.deck_id === deck).map((row): unknown => row.deleted_at);
  expect(tombstones(deckId)).toEqual([deleted?.deleted_at, deleted?.deleted_at]);
  expect(tombstones(otherId)).toEqual([null]);
});
