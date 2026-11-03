import { randomUUID } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";

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

/** Signs a new user up, hands the browser its session, and returns a client signed in as it. */
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
  const email = `web-card-editor-${randomUUID()}@example.com`;
  const password = "web-card-editor-test-password";
  const signup = await auth.auth.signUp({ email, password });
  expect(signup.error).toBeNull();
  const userId = signup.data.user?.id;
  if (!userId) throw new Error("sign-up returned no fixture user");
  await context.addCookies([...jar].map(([name, value]) => ({ name, value, url: baseURL })));
  const db = createClient(url, key, { auth: { persistSession: false } });
  await db.auth.signInWithPassword({ email, password });
  return { db, userId };
}

test("writes every 칸 type as free v2, and opens and saves a stored card over its own row", async ({
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
  // A one-line field is the phone's AppTextField, 50 high and padded 13 by 16; a table's cell is
  // the phone's cell field, padded 12 all round, 48 high.
  for (const [name, box] of [
    ["뜻", { height: 50, padding: "13px 16px" }],
    ["문장", { height: 50, padding: "13px 16px" }],
    ["1열 머리글", { height: 48, padding: "12px" }],
    ["2행 1열", { height: 48, padding: "12px" }],
  ] as const) {
    expect(
      await page.getByRole("textbox", { name, exact: true }).evaluate((field) => ({
        height: Math.round(field.getBoundingClientRect().height),
        padding: getComputedStyle(field).padding,
      })),
      name,
    ).toEqual(box);
  }
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

/** A [width] by [height] PNG of one colour, which the browser decodes and prepares as a JPEG. */
function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x60)]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", pixels),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * About a second of silent MP3: 38 MPEG-1 Layer III frames of 1,152 samples at 44.1 kHz, mono at
 * 128 kbit/s, each 417 bytes, whose side information and data are empty.
 */
function silentMp3(): Buffer {
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0xc0]);
  return Buffer.concat(Array.from({ length: 38 }, () => frame));
}

test("adds a 사진 칸 with its boxes and a 소리 칸, which study draws and plays, and releases a removed one's file", async ({
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
    name: "사진 단어장",
    visibility: "private",
    created_at: time,
    updated_at: time,
  });
  expect(deck.error).toBeNull();
  /** Whether Storage holds the user's object [id], read as the user. */
  const held = async (id: string) =>
    (await db.storage.from("media").download(`${userId}/${id}`)).error === null;
  /** The user's `media` rows, by id, with their kind and type. */
  const rows = async () =>
    ((await db.from("media").select("id,kind,mime_type")).data ?? []).map((row): unknown => row);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/decks/${deckId}`);
  const manual = page.getByRole("button", { name: "직접 입력" });
  await untilReacted(
    () => page.getByRole("button", { name: "카드 추가" }).click(),
    () => manual.isVisible(),
  );
  await manual.click();
  const dialog = page.getByRole("dialog", { name: "새 카드" });
  await dialog.getByRole("textbox", { name: "앞면", exact: true }).fill("Name the city");
  await dialog.getByRole("textbox", { name: "뒷면", exact: true }).fill("수도");
  const addCell = async (name: string) => {
    await dialog.getByRole("button", { name: "+ 칸 추가" }).click();
    const sheet = page.getByRole("dialog", { name: "칸 추가" });
    await sheet.getByRole("button", { name, exact: true }).click();
    await expect(sheet).toBeHidden();
  };

  // A photo, prepared whole in the browser, with a box from "빈칸 추가" and one drawn by a drag.
  await addCell("사진");
  await capture(page, "photo-empty");
  await dialog
    .getByLabel("앨범에서 고르기")
    .setInputFiles({ name: "city.png", mimeType: "image/png", buffer: png(400, 300) });
  await dialog.getByRole("button", { name: "빈칸 추가" }).click();
  await dialog.getByRole("textbox", { name: "정답 (선택)" }).fill("Paris");
  const photo = dialog.locator("[data-photo]");
  await photo.scrollIntoViewIfNeeded();
  const frame = await photo.boundingBox();
  if (!frame) throw new Error("the photo is not drawn");
  expect(frame.width / frame.height).toBeCloseTo(4 / 3, 1);
  await page.mouse.move(frame.x + frame.width * 0.05, frame.y + frame.height * 0.05);
  await page.mouse.down();
  await page.mouse.move(frame.x + frame.width * 0.25, frame.y + frame.height * 0.3, { steps: 4 });
  await page.mouse.up();
  await expect(dialog.getByRole("button", { name: "빈칸 2" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await capture(page, "photo");

  // A sound picked from a file; recording is offered where the browser records AAC alone.
  await addCell("소리");
  const records = await page.evaluate(
    () =>
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported("audio/mp4;codecs=mp4a.40.2"),
  );
  await expect(dialog.getByRole("button", { name: "녹음하기" })).toHaveCount(records ? 1 : 0);
  await dialog
    .getByLabel("파일에서 고르기")
    .setInputFiles({ name: "city.mp3", mimeType: "audio/mpeg", buffer: silentMp3() });
  await expect(dialog.getByRole("button", { name: "소리 듣기" })).toBeVisible();
  await capture(page, "sound");
  await dialog.getByRole("button", { name: "저장", exact: true }).click();
  await expect(dialog).toBeHidden();

  // The files went first, as their rows and objects, and the card names them.
  const written = await db
    .from("cards")
    .select("id,front,back,template,template_version")
    .eq("deck_id", deckId)
    .single();
  expect(written.data).toMatchObject({ template: "free", template_version: 2, back: [] });
  const cardId = String(written.data?.id);
  type Block = { type: string; payload: Record<string, unknown> };
  const [, image, sound] = written.data?.front as Block[];
  expect(image).toMatchObject({ type: "image", payload: { width: 400, height: 300 } });
  expect(image?.payload).not.toHaveProperty("side");
  const boxes = image?.payload.boxes as { id: string; answer?: string; x: number; w: number }[];
  expect(boxes.map(({ id, answer }) => [id, answer])).toEqual([
    ["1", "Paris"],
    ["2", undefined],
  ]);
  expect(boxes[1]?.x).toBeCloseTo(0.05, 1);
  expect(boxes[1]?.w).toBeCloseTo(0.2, 1);
  expect(sound).toMatchObject({ type: "audio", payload: { side: "front" } });
  const durationMs = Number(sound?.payload.duration_ms);
  expect(durationMs).toBeGreaterThan(900);
  expect(durationMs).toBeLessThan(1100);
  const photoId = String(image?.payload.media);
  const soundId = String(sound?.payload.media);
  expect(await rows()).toEqual(
    expect.arrayContaining([
      { id: photoId, kind: "image", mime_type: "image/jpeg" },
      { id: soundId, kind: "audio", mime_type: "audio/mpeg" },
    ]),
  );
  expect([await held(photoId), await held(soundId)]).toEqual([true, true]);

  // Study draws the photo from a URL signed for the user, its boxes hidden, and plays the sound.
  await page.addInitScript(() => {
    window.localStorage.setItem("studyCoachShown", "true");
  });
  await page.goto(`/study?decks=${deckId}`);
  const front = page.getByRole("group", { name: "앞면", exact: true });
  await expect(front).toBeVisible();
  const drawn = front.locator(`[data-image="${photoId}"]`);
  const style = (await drawn.getAttribute("style")) ?? "";
  expect(style).toContain(`/storage/v1/object/sign/media/${userId}/${photoId}?token=`);
  const signed = /url\("([^"]+)"\)/.exec(style)?.[1] ?? "";
  const fetched = await page.request.get(signed);
  expect(fetched.status()).toBe(200);
  expect(fetched.headers()["content-type"]).toBe("image/jpeg");
  await expect(drawn.locator('[data-box="hidden"]')).toHaveCount(2);
  await expect(page.getByRole("button", { name: "소리 듣기" })).toBeVisible();
  await capture(page, "study");

  // Removing the 소리 칸 from the card releases its file, and the photo the card keeps stays.
  await page.goto(`/decks/${deckId}`);
  await page.getByRole("button", { name: /^Name the city/ }).click();
  const editor = page.getByRole("dialog", { name: "카드 편집" });
  await expect(editor.locator("[data-photo]")).toHaveAttribute(
    "style",
    new RegExp(`/storage/v1/object/sign/media/${userId}/${photoId}\\?token=`),
  );
  await capture(page, "stored-media");
  await editor.getByRole("button", { name: "3번째 칸 메뉴" }).click();
  await page.getByRole("menuitem", { name: "삭제" }).click();
  await expect(editor.getByRole("heading", { name: "소리" })).toHaveCount(0);
  await editor.getByRole("button", { name: "저장", exact: true }).click();
  await expect(editor).toBeHidden();
  const edited = await db.from("cards").select("front").eq("id", cardId).single();
  expect((edited.data?.front as Block[]).map(({ type }) => type)).toEqual(["text", "image"]);
  await expect.poll(() => held(soundId)).toBe(false);
  expect(await held(photoId)).toBe(true);
  expect(await rows()).toEqual([{ id: photoId, kind: "image", mime_type: "image/jpeg" }]);
});

test("keeps a 빈칸 문장's selection and its 빈칸 넣기 while the editor scrolls, by touch and by the wheel", async ({
  browser,
  baseURL,
}) => {
  if (!baseURL) throw new Error("skipped without local stack");
  const context = await browser.newContext({
    baseURL,
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const { db, userId } = await signUp(context, baseURL);
  const deckId = randomUUID();
  const time = new Date(Date.now() - 86_400_000).toISOString();
  const deck = await db.from("decks").insert({
    id: deckId,
    user_id: userId,
    name: "빈칸 단어장",
    visibility: "private",
    created_at: time,
    updated_at: time,
  });
  expect(deck.error).toBeNull();
  await page.goto(`/decks/${deckId}`);
  const manual = page.getByRole("button", { name: "직접 입력" });
  await untilReacted(
    () => page.getByRole("button", { name: "카드 추가" }).click(),
    () => manual.isVisible(),
  );
  await manual.click();
  const dialog = page.getByRole("dialog", { name: "새 카드" });
  // Enough 칸 after the line that the editor scrolls.
  for (const name of ["빈칸 문장", "글", "글", "글"]) {
    await dialog.getByRole("button", { name: "+ 칸 추가" }).click();
    await page
      .getByRole("dialog", { name: "칸 추가" })
      .getByRole("button", { name, exact: true })
      .click();
  }
  const line = page.getByRole("textbox", { name: "문장", exact: true });
  await line.fill("The capital of France is Paris");
  await line.evaluate((field: HTMLTextAreaElement) => {
    field.scrollIntoView({ block: "start" });
    field.focus();
    field.setSelectionRange(4, 11);
  });
  const insert = page.getByRole("button", { name: "빈칸 넣기", exact: true });
  await expect(insert, "setup: the action shows").toBeVisible();
  const scroller = dialog.locator(".overflow-y-auto");
  const offset = () => scroller.evaluate((element) => element.scrollTop);
  const selection = () =>
    line.evaluate((field: HTMLTextAreaElement) => [field.selectionStart, field.selectionEnd]);
  const kept = async (how: string) => {
    await expect(line, how).toBeFocused();
    expect(await selection(), how).toEqual([4, 11]);
    await expect(insert, how).toBeVisible();
  };

  // A touch drag off the line, on the 글 under it, back toward the top.
  const before = await offset();
  const cdp = await context.newCDPSession(page);
  const box = await dialog.getByRole("textbox", { name: "앞면", exact: true }).nth(1).boundingBox();
  if (!box) throw new Error("setup: a 글 under the line is on screen");
  await cdp.send("Input.synthesizeScrollGesture", {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
    yDistance: 200,
    gestureSourceType: "touch",
    speed: 800,
  });
  await expect.poll(offset, { message: "it scrolled by touch" }).not.toBe(before);
  await kept("by touch");
  // Shot as scrolled, at the phone's height rather than capture's.
  const directory = process.env.E2E_SCREENSHOTS;
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    if (directory)
      await page.screenshot({
        path: `${directory}/${colorScheme}/web-card-editor-cloze-scrolled-390.png`,
      });
  }
  await page.emulateMedia({ colorScheme: "light" });

  // The wheel, as a pointer scrolls.
  const touched = await offset();
  await page.mouse.move(box.x + box.width / 2, box.y);
  await page.mouse.wheel(0, 120);
  await expect.poll(offset, { message: "it scrolled by the wheel" }).not.toBe(touched);
  await kept("by the wheel");

  await insert.click();
  await expect(page.getByRole("button", { name: "빈칸 풀기, capital", exact: true })).toBeVisible();
  await context.close();
});
