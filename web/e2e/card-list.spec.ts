import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.E2E_SUPABASE_URL;
const supabaseKey = process.env.E2E_SUPABASE_KEY;
// Where to save the page in both themes at 390 and 1280 px, for review; none is taken unless it
// names a directory.
const screenshots = process.env.E2E_SCREENSHOTS;

test.skip(
  !supabaseUrl || !supabaseKey,
  "needs the local Supabase stack scripts/test-web.ts starts, which sets E2E_SUPABASE_URL and E2E_SUPABASE_KEY",
);

test("draws a note's 사진 card at the thumbnail height, its row no taller than the photo and its answers (#629)", async ({
  page,
  context,
  baseURL,
}) => {
  if (!supabaseUrl || !supabaseKey || !baseURL) throw new Error("skipped above");
  const email = `web-card-list-${randomUUID()}@example.com`;
  const password = "web-card-list-password";
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
  await context.addCookies([...cookies].map(([name, value]) => ({ name, value, url: baseURL })));
  const userId = signUp.data.user?.id;

  const phone = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  expect((await phone.auth.signInWithPassword({ email, password })).error).toBeNull();
  const deckId = randomUUID();
  const now = Date.now();
  const at = (offset: number) => new Date(now + offset * 1000).toISOString();
  expect(
    (
      await phone.from("decks").insert({
        id: deckId,
        user_id: userId,
        name: "한국사",
        created_at: at(0),
        updated_at: at(0),
      })
    ).error,
  ).toBeNull();
  const kinds: [string, unknown[]][] = [
    [
      "ephemeral",
      [
        {
          type: "senses",
          v: 2,
          id: randomUUID(),
          payload: {
            term: "ephemeral",
            ask: "term",
            senses: [{ labels: [], meaning: "덧없는, 순식간의", examples: [] }],
          },
        },
      ],
    ],
    [
      "조선의 최고 법전은?",
      [
        {
          type: "text",
          v: 3,
          id: randomUUID(),
          payload: { front: "조선의 최고 법전은?", back: "경국대전, 성종 때 완성" },
        },
      ],
    ],
    [
      "태조는 1392년에 조선을 세웠다.",
      [
        {
          type: "text",
          v: 3,
          id: randomUUID(),
          payload: { front: "태조의 건국", back: "이성계" },
        },
        {
          type: "cloze",
          v: 2,
          id: randomUUID(),
          payload: { text: "태조는 {{c1::1392}}년에 조선을 세웠다." },
        },
      ],
    ],
    [
      "세종대왕은 1443년에 훈민정음을 창제했다.",
      [
        {
          type: "cloze",
          v: 2,
          id: randomUUID(),
          payload: { text: "세종대왕은 {{c1::1443}}년에 {{c2::훈민정음}}을 창제했다." },
        },
      ],
    ],
    [
      "조선 전기 왕과 업적",
      [
        {
          type: "text",
          v: 3,
          id: randomUUID(),
          payload: { front: "조선 전기 왕과 업적", back: "" },
        },
        {
          type: "table",
          v: 1,
          id: randomUUID(),
          payload: {
            columns: ["왕", "업적"],
            rows: [
              ["태종", "호패법"],
              ["세종", "훈민정음"],
              ["세조", "직전법"],
              ["성종", "경국대전"],
            ],
            blanks: [0, 1, 2, 3].map((row) => ({ row, column: 1 })),
            spans: [],
          },
        },
      ],
    ],
    [
      "지도",
      [
        {
          type: "image",
          v: 2,
          id: randomUUID(),
          payload: {
            media: randomUUID(),
            width: 3,
            height: 2,
            boxes: [
              { id: randomUUID(), x: 0.1, y: 0.15, w: 0.3, h: 0.2, answer: "한양" },
              { id: randomUUID(), x: 0.55, y: 0.6, w: 0.35, h: 0.2, answer: "개성" },
            ],
          },
        },
      ],
    ],
  ];
  const inserted = await phone.from("cards").insert(
    kinds.map(([key, cells], index) => ({
      id: randomUUID(),
      user_id: userId,
      deck_id: deckId,
      front: cells,
      back: [],
      template: "free",
      template_version: 2,
      card_key: key,
      source: "manual",
      created_at: at(index + 1),
      updated_at: at(index + 1),
    })),
  );
  expect(inserted.error).toBeNull();

  await page.goto(`/decks/${deckId}`);
  await expect(page.getByRole("heading", { name: "한국사", exact: true })).toBeVisible();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
    // The 사진 card's row: the one button holding a photo.
    const row = page.locator("button", { has: page.locator("[data-image]") });
    const frame = await row.locator("[data-image]").boundingBox();
    const answers = await row.locator("[data-hatched]").boundingBox();
    const box = await row.boundingBox();
    if (!frame || !answers || !box) throw new Error("the 사진 row is not laid out");
    // The photo at the thumbnail's 96 px height, at its 3:2.
    expect({ width, height: frame.height }).toEqual({ width, height: 96 });
    expect(frame.width).toBeCloseTo(144, 0);
    // The row is its padding, the photo, the gap and the answers' box, and nothing taller.
    expect(box.height).toBeCloseTo(12 + frame.height + 8 + answers.height + 12, 0);
    // Every hatched box draws its text at the one `secondary` size, a split card's back and a whole
    // card's added part alike (#845).
    const sizes = await page
      .locator("[data-hatched]")
      .evaluateAll((boxes) => boxes.map((box) => getComputedStyle(box).fontSize));
    expect(sizes.length).toBeGreaterThan(3);
    expect(new Set(sizes)).toEqual(new Set(["13px"]));
    if (!screenshots) continue;
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.screenshot({
        path: `${screenshots}/${colorScheme}/web-card-list-${String(width)}.png`,
        fullPage: true,
      });
    }
    await page.emulateMedia({ colorScheme: null });
  }
});
