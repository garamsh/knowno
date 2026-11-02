import { randomUUID } from "node:crypto";

import { expect, type Page, test } from "@playwright/test";
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

// Where to save screenshots of the editor; none are taken unless it names a directory. The
// viewport is tall, so the sheet shows its groups rather than scrolling them away.
async function capture(page: Page, name: string) {
  const directory = process.env.E2E_SCREENSHOTS;
  await page.addStyleTag({
    content: "*, *::before, *::after { transition: none !important; }",
  });
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 1600 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      if (directory)
        await page.screenshot({
          path: `${directory}/${colorScheme}/web-card-editor-${name}-${String(width)}.png`,
        });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
}

const text = (id: string, value: string) => ({ type: "text", v: 1, id, payload: { text: value } });

test("writes every 칸 type as free v2, and opens and saves a stored card over its own row", async ({
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
  const email = `web-card-editor-${randomUUID()}@example.com`;
  const password = "web-card-editor-test-password";
  const signup = await auth.auth.signUp({ email, password });
  expect(signup.error).toBeNull();
  const userId = signup.data.user?.id;
  if (!userId) throw new Error("sign-up returned no fixture user");
  await context.addCookies([...jar].map(([name, value]) => ({ name, value, url: baseURL })));
  const db = createClient(url, key, { auth: { persistSession: false } });
  await db.auth.signInWithPassword({ email, password });

  const deckId = randomUUID();
  const time = new Date(Date.now() - 86_400_000).toISOString();
  const deck = await db.from("decks").insert({
    id: deckId,
    user_id: userId,
    name: "칸 단어장",
    visibility: "private",
    created_at: time,
    updated_at: time,
  });
  expect(deck.error).toBeNull();
  const row = (id: string, front: unknown, back: unknown, cardKey: string, version = 1) => ({
    id,
    deck_id: deckId,
    user_id: userId,
    front,
    back,
    card_key: cardKey,
    source: "manual",
    template: "free",
    template_version: version,
    created_at: time,
    updated_at: time,
  });
  const v1Id = randomUUID();
  const mediaId = randomUUID();
  const boxedId = randomUUID();
  const soundId = randomUUID();
  const laterId = randomUUID();
  const seeded = await db.from("cards").insert([
    row(
      v1Id,
      [
        text("f1", "A photo card"),
        {
          type: "image",
          v: 1,
          id: "i1",
          payload: { media: mediaId, width: 800, height: 600, boxes: [] },
        },
        {
          type: "image",
          v: 1,
          id: "i2",
          payload: {
            media: boxedId,
            width: 800,
            height: 600,
            boxes: [{ id: "1", x: 0.1, y: 0.2, w: 0.4, h: 0.3, answer: "Paris" }],
          },
        },
      ],
      [
        { type: "audio", v: 1, id: "a1", payload: { media: soundId, duration_ms: 7000 } },
        text("b1", "뒤"),
      ],
      "a photo card",
    ),
    row(laterId, [text("f2", "From a later build")], [text("b2", "뒤")], "from a later build", 3),
  ]);
  expect(seeded.error).toBeNull();
  const reviewId = randomUUID();
  const reviewed = await db.from("reviews").insert({
    id: reviewId,
    card_id: v1Id,
    user_id: userId,
    rating: "good",
    reviewed_at: time,
    duration_ms: 1000,
    updated_at: time,
  });
  expect(reviewed.error).toBeNull();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/decks/${deckId}`);

  // A new card holding one 칸 of each type the web can start.
  const manual = page.getByRole("button", { name: "직접 입력" });
  await untilReacted(
    () => page.getByRole("button", { name: "카드 추가" }).click(),
    () => manual.isVisible(),
  );
  await manual.click();
  await expect(page.getByRole("textbox", { name: "앞면", exact: true })).toBeFocused();
  await capture(page, "new");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByText("앞면에 보일 내용을 하나 이상 넣어 주세요")).toBeVisible();
  await capture(page, "refused");
  await page.getByRole("textbox", { name: "앞면", exact: true }).fill("Capitals");
  await page.getByRole("textbox", { name: "뒷면", exact: true }).fill("수도");
  const dialog = page.getByRole("dialog", { name: "새 카드" });
  const addCell = async (name: string) => {
    await dialog.getByRole("button", { name: "+ 칸 추가" }).click();
    const sheet = page.getByRole("dialog", { name: "칸 추가" });
    await capture(page, "add");
    await sheet.getByRole("button", { name, exact: true }).click();
    await expect(sheet).toBeHidden();
  };
  // Escape closes a 칸's menu alone, never the sheet around it.
  await dialog.getByRole("button", { name: "1번째 칸 메뉴" }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await addCell("단어");
  await page.getByRole("textbox", { name: "단어", exact: true }).fill("capital");
  await page.getByRole("textbox", { name: "라벨", exact: true }).fill("명");
  await page.getByRole("textbox", { name: "뜻", exact: true }).fill("수도");
  await addCell("빈칸 문장");
  const line = page.getByRole("textbox", { name: "문장", exact: true });
  await line.fill("The capital of France is Paris");
  await line.evaluate((field: HTMLTextAreaElement) => {
    field.focus();
    field.setSelectionRange(25, 30);
  });
  await page.getByRole("button", { name: "빈칸 넣기" }).click();
  await addCell("표");
  await page.getByRole("textbox", { name: "1열 머리글" }).fill("나라");
  await page.getByRole("textbox", { name: "2열 머리글" }).fill("수도");
  await page.getByRole("textbox", { name: "1행 1열" }).fill("일본");
  await page.getByRole("textbox", { name: "1행 2열" }).fill("도쿄");
  await page.getByRole("button", { name: "빈칸", exact: true }).click();
  await page.getByRole("textbox", { name: "2행 1열" }).fill("한국");
  await page.getByRole("textbox", { name: "2행 2열" }).fill("서울");
  await expect(page.getByRole("button", { name: "2행 삭제" })).toBeVisible();
  await capture(page, "every-type");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(dialog).toBeHidden();

  const written = await db
    .from("cards")
    .select("front,back,template,template_version,card_key,revision")
    .eq("deck_id", deckId)
    .like("card_key", "capitals%");
  expect(written.error).toBeNull();
  expect(written.data).toHaveLength(1);
  const card = written.data?.[0];
  expect(card).toMatchObject({ template: "free", template_version: 2, back: [] });
  expect((card?.front as { type: string; v: number }[]).map(({ type, v }) => [type, v])).toEqual([
    ["text", 2],
    ["senses", 2],
    ["cloze", 1],
    ["table", 2],
  ]);
  expect(card?.card_key).toContain("the capital of france is paris");

  // A stored card opens from its row, its photo and sound kept, and its side changed.
  await page.getByRole("button", { name: /^A photo card/ }).click();
  const editor = page.getByRole("dialog", { name: "카드 편집" });
  await expect(editor.getByRole("heading", { name: "소리" })).toBeVisible();
  await capture(page, "stored");
  await editor.getByRole("textbox", { name: "앞면", exact: true }).fill("A photo card, edited");
  const before = await db.from("cards").select("revision").eq("id", v1Id).single();
  await editor.getByRole("button", { name: "저장", exact: true }).click();
  await expect(editor).toBeHidden();
  const after = await db
    .from("cards")
    .select("id,source,template,template_version,back,card_key,revision,updated_at,front")
    .eq("id", v1Id)
    .single();
  expect(after.data).toMatchObject({
    id: v1Id,
    source: "manual",
    template: "free",
    template_version: 2,
    back: [],
    card_key: `a photo card, edited ${mediaId} ${boxedId} paris`,
  });
  expect(Number(after.data?.revision)).toBeGreaterThan(Number(before.data?.revision));
  expect(Date.parse(String(after.data?.updated_at))).toBeGreaterThan(Date.parse(time));
  const blocks = after.data?.front as { id: string; payload: { media?: string; side?: string } }[];
  expect(blocks.map(({ id }) => id)).toEqual(["f1", "i1", "i2", "a1"]);
  expect(blocks[1]?.payload).toMatchObject({ media: mediaId, side: "front" });
  expect(blocks[2]?.payload).not.toHaveProperty("side");
  expect(blocks[3]?.payload).toMatchObject({ media: soundId, side: "back" });
  const reviews = await db.from("reviews").select("id").eq("card_id", v1Id);
  expect(reviews.data).toEqual([{ id: reviewId }]);

  // A card of a later template opens read-only.
  await page.getByRole("button", { name: /^From a later build/ }).click();
  const readOnly = page.getByRole("dialog", { name: "카드 편집" });
  await expect(
    readOnly.getByText("이 버전에서는 편집할 수 없어요", { exact: false }),
  ).toBeVisible();
  await expect(readOnly.getByRole("button", { name: "저장", exact: true })).toHaveCount(0);
  await capture(page, "read-only");
});
