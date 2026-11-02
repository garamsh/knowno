import { randomUUID } from "node:crypto";

import { expect, type Page, type Request, test } from "@playwright/test";
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

// Where to save screenshots of the flow in both themes; none are taken unless it names a directory.
async function capture(page: Page, name: string) {
  const directory = process.env.E2E_SCREENSHOTS;
  await page.addStyleTag({
    content: "*, *::before, *::after { transition: none !important; animation: none !important; }",
  });
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: width < 1024 ? 844 : 900 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      if (directory)
        await page.screenshot({
          path: `${directory}/${colorScheme}/web-photo-${name}-${String(width)}.png`,
        });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
}

/** The width and height a JPEG's frame header states, or null for bytes that are no JPEG. */
function jpegSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1] ?? 0;
    const length = bytes.readUInt16BE(at + 2);
    if (marker >= 0xc0 && marker <= 0xc3)
      return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
    at += 2 + length;
  }
  return null;
}

/** The photo a `readPhoto` call uploads: the JPEG inside its multipart body, or null for another action. */
function uploadOf(request: Request): Buffer | null {
  const body = request.postDataBuffer();
  if (!request.headers()["next-action"] || !body) return null;
  const start = body.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
  return start < 0 ? null : body.subarray(start);
}

/** A JPEG with an EXIF orientation of 6, rotated 90° clockwise to show upright. */
function withOrientation6(jpeg: Buffer): Buffer {
  const tiff = Buffer.from([
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00,
    0x00, 0x01, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
  const exif = Buffer.concat([Buffer.from("Exif\0\0", "binary"), tiff]);
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(exif.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), app1, exif, jpeg.subarray(2)]);
}

const text = (value: string) => ({
  type: "text",
  v: 1,
  id: randomUUID(),
  payload: { text: value },
});

/** A card the action returns, as `parseCandidates` makes it. */
function candidate(front: string, back: string) {
  return {
    id: randomUUID(),
    reverseId: randomUUID(),
    topic: "도시",
    kind: "note",
    identify: false,
    pronunciation: null,
    extras: [],
    front: [text(front)],
    back: [text(back)],
    selected: true,
  };
}

/** A vocabulary entry the action returns, with two senses, a pronunciation and an extra. */
function entry(word: string) {
  const sense = (meaning: string, labels: unknown[]) => ({ labels, meaning, examples: [] });
  return {
    ...candidate(word, ""),
    topic: "단어",
    kind: "vocabulary",
    pronunciation: "ˈæpəl",
    extras: [{ label: "유의어", text: "pome" }],
    back: [
      {
        type: "senses",
        v: 1,
        id: randomUUID(),
        payload: {
          senses: [
            sense("사과", [{ kind: "part_of_speech", category: "noun", text: "명" }]),
            sense("사과나무", []),
          ],
        },
      },
    ],
  };
}

test("normalises each photo, shows a 502 on its row, retries it in place, and saves the cards", async ({
  page,
  context,
  baseURL,
}) => {
  if (!url || !key || !baseURL) throw new Error("skipped without local stack");
  // Encoding the fixtures, preparing them in the page and twelve captures take longer than 30 s.
  test.setTimeout(120_000);
  const jar = new Map<string, string>();
  const auth = createServerClient(url, key, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) jar.set(name, value);
      },
    },
  });
  const email = `web-photo-${randomUUID()}@example.com`;
  const password = "web-photo-test-password";
  const signup = await auth.auth.signUp({ email, password });
  expect(signup.error).toBeNull();
  const userId = signup.data.user?.id;
  if (!userId) throw new Error("sign-up returned no fixture user");
  await context.addCookies([...jar].map(([name, value]) => ({ name, value, url: baseURL })));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/decks");
  // The fixtures are drawn by Chromium's own encoder: a noisy 3200×2400 JPEG well over the
  // former 6 MiB refusal, a 600×400 JPEG given an EXIF orientation, and a small PNG.
  const [large, landscape, png] = await page.evaluate(async () => {
    async function draw(width: number, height: number, type: string, noise: boolean) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no canvas");
      if (noise) {
        const pixels = context.createImageData(width, height);
        for (let at = 0; at < pixels.data.length; at += 1)
          pixels.data[at] = at % 4 === 3 ? 255 : Math.floor(Math.random() * 256);
        context.putImageData(pixels, 0, 0);
      } else {
        context.fillStyle = "#c00";
        context.fillRect(0, 0, width / 2, height);
        context.fillStyle = "#00c";
        context.fillRect(width / 2, 0, width / 2, height);
      }
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, type, 0.95);
      });
      if (!blob) throw new Error("no blob");
      // Base64 crosses to the test in one string; an array of numbers this large does not.
      const data = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          resolve(typeof reader.result === "string" ? reader.result : "");
        };
        reader.readAsDataURL(blob);
      });
      return data.slice(data.indexOf(",") + 1);
    }
    return [
      await draw(3200, 2400, "image/jpeg", true),
      await draw(600, 400, "image/jpeg", false),
      await draw(800, 600, "image/png", false),
    ];
  });
  const largeBytes = Buffer.from(large, "base64");
  expect(largeBytes.length).toBeGreaterThan(6 * 1024 * 1024);

  // The extraction is substituted at the Server Action: each call reaches the built app, and the
  // value it returns is replaced by the one readPhoto gives for the function's answer below.
  const answers = [
    { failure: { kind: "model" } },
    { cards: [candidate("서울", "한국의 수도")] },
    { cards: [candidate("도쿄", "일본의 수도")] },
    { cards: [candidate("파리", "프랑스의 수도"), entry("apple")] },
  ];
  const sizes: ({ width: number; height: number } | null)[] = [];
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reachedFirst: () => void = () => undefined;
  const firstReached = new Promise<void>((resolve) => {
    reachedFirst = resolve;
  });
  await page.route("**/decks**", async (route) => {
    const photo = uploadOf(route.request());
    if (route.request().method() !== "POST" || !photo) {
      await route.fallback();
      return;
    }
    const call = sizes.length;
    sizes.push(jpegSize(photo));
    if (call === 0) {
      reachedFirst();
      await held;
    }
    const response = await route.fetch();
    const body = (await response.text()).replace(
      /^(\d+:)\{"(?:failure|cards)".*$/mu,
      (_, row: string) => `${row}${JSON.stringify(answers[call])}`,
    );
    await route.fulfill({ response, body });
  });

  await untilReacted(
    () => page.getByRole("button", { name: "새 덱 만들기", exact: true }).click(),
    () => page.getByRole("dialog").isVisible(),
  );
  await page.getByLabel("앨범에서 고르기", { exact: true }).setInputFiles([
    { name: "large.jpg", mimeType: "image/jpeg", buffer: largeBytes },
    {
      name: "rotated.jpg",
      mimeType: "image/jpeg",
      buffer: withOrientation6(Buffer.from(landscape, "base64")),
    },
    { name: "small.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") },
  ]);
  await firstReached;
  await expect(
    page.getByRole("heading", { name: "사진 3장 중 0장 읽음", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("읽는 중", { exact: true })).toBeVisible();
  await capture(page, "reading");
  release();

  await expect(
    page.getByRole("heading", { name: "사진 1장을 읽지 못했어요", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("카드를 읽지 못했어요. 잠시 후 다시 시도해 주세요.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("카드 1장", { exact: true })).toHaveCount(2);
  await capture(page, "failed");
  await page.getByRole("button", { name: "사진 1 다시 시도", exact: true }).click();

  await expect(
    page.getByRole("heading", { name: "카드 4장을 만들었어요", exact: true }),
  ).toBeVisible();
  expect(sizes).toEqual([
    { width: 2048, height: 1536 },
    { width: 400, height: 600 },
    { width: 800, height: 600 },
    { width: 2048, height: 1536 },
  ]);
  await expect(page.getByText("새 덱에 추가돼요", { exact: true })).toBeVisible();
  await capture(page, "list");
  await page.getByRole("button", { name: "사진 2, 카드 1장", exact: true }).click();
  await expect(page.getByRole("button", { name: "사진 2, 카드 1장", exact: true })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await capture(page, "collapsed");
  await page.getByRole("button", { name: "단어 카드 모양, 앞면에 단어", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "발음 표시", exact: true }).click();
  await page.getByRole("button", { name: "단어 카드 모양, 앞면에 단어", exact: true }).click();
  await expect(page.getByRole("menu", { name: "단어 카드 모양", exact: true })).toBeVisible();
  // The menu stays open through each capture: a viewport change does not close it.
  await capture(page, "menu");
  await page.getByRole("menuitemradio", { name: "양쪽 방향 모두", exact: true }).click();
  await page.getByRole("button", { name: "새 덱", exact: true }).click();
  await capture(page, "deck-choice");
  await page.getByRole("radio", { name: "새 덱", exact: true }).click();
  await page.getByRole("button", { name: "카드 5장 추가", exact: true }).click();
  await page.getByRole("textbox", { name: "이름", exact: true }).fill("사진 덱");
  await page.getByRole("button", { name: "만들기", exact: true }).click();
  await expect(page.getByRole("heading", { name: "사진 덱", exact: true })).toBeVisible();

  const client = createClient(url, key, { auth: { persistSession: false } });
  expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull();
  const read = await client
    .from("cards")
    .select("card_key,source,revision")
    .eq("user_id", userId)
    .order("card_key");
  expect(read.error).toBeNull();
  // "양쪽 방향" saved the entry both ways: its word, and its meanings as a front of their own.
  expect(read.data?.map((card) => String(card.card_key)).sort()).toEqual(
    ["[명] 사과 사과나무", "apple", "도쿄", "서울", "파리"].sort(),
  );
  for (const card of read.data ?? []) {
    expect(card).toMatchObject({ source: "import" });
    expect(Number(card.revision)).toBeGreaterThan(0);
  }
});
