import { randomUUID } from "node:crypto";

import { expect, type Page, test } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

import { xlsxOf } from "../src/testing/xlsx";
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
  // A theme change animates colours; the captures show the settled ones.
  await page.addStyleTag({
    content: "*, *::before, *::after { transition: none !important; }",
  });
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: width < 1024 ? 844 : 900 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      // The brand's marks swap images by theme; the capture waits for the shown ones to load.
      await page.waitForFunction(() =>
        Array.from(document.images).every(
          (image) => image.offsetParent === null || (image.complete && image.naturalWidth > 0),
        ),
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      if (directory)
        await page.screenshot({
          path: `${directory}/${colorScheme}/web-spreadsheet-${name}-${String(width)}.png`,
          fullPage: true,
        });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
}

test("adds a deck's cards from a small .xlsx after review, and the server holds them", async ({
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
  const email = `web-spreadsheet-${randomUUID()}@example.com`;
  const password = "web-spreadsheet-test-password";
  const signup = await auth.auth.signUp({ email, password });
  expect(signup.error).toBeNull();
  const userId = signup.data.user?.id;
  if (!userId) throw new Error("sign-up returned no fixture user");
  await context.addCookies([...jar].map(([name, value]) => ({ name, value, url: baseURL })));

  const workbook = xlsxOf([
    {
      name: "단어",
      rows: [
        ["단어", "뜻", "라벨", "예문"],
        ["apple", "사과", "명", "an apple a day"],
        ["run", "달리다", "동", null],
        ["", "앞면 없음"],
        ["date", { number: 46324, format: 14 }],
      ],
    },
  ]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/decks");
  await untilReacted(
    () => page.getByRole("button", { name: "새 덱 만들기", exact: true }).click(),
    () => page.getByRole("dialog").isVisible(),
  );
  await page.getByRole("button", { name: "파일에서 고르기", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "파일에서 카드 추가", exact: true }),
  ).toBeVisible();
  await capture(page, "start");
  await page.getByLabel("파일 고르기", { exact: true }).setInputFiles({
    name: "words.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(workbook),
  });
  await expect(page.getByRole("heading", { name: "카드 확인", exact: true })).toBeVisible();
  await expect(page.getByRole("switch", { name: "첫 행은 머리글", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page
    .getByRole("combobox", { name: "라벨", exact: true })
    .selectOption({ label: "C · 라벨" });
  await page
    .getByRole("combobox", { name: "예문", exact: true })
    .selectOption({ label: "D · 예문" });
  await expect(
    page.getByText("앞면이나 뒷면이 빈 행 1개는 건너뛰어요", { exact: true }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "이름", exact: true }).fill("엑셀 단어");
  await capture(page, "review");
  // The sheet's end: the deck it adds to and its one primary action.
  await page
    .getByRole("dialog")
    .locator(".overflow-y-auto")
    .evaluate((scroller) => {
      scroller.scrollTop = scroller.scrollHeight;
    });
  await capture(page, "save");
  await page.getByRole("button", { name: "3장 추가", exact: true }).click();
  await expect(page.getByRole("heading", { name: "엑셀 단어", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "apple, 뒷면 가려짐", exact: true })).toBeVisible();

  const client = createClient(url, key, { auth: { persistSession: false } });
  expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull();
  const read = await client
    .from("cards")
    .select("front,back,source,template,template_version,card_key,revision")
    .eq("user_id", userId)
    .order("card_key");
  expect(read.error).toBeNull();
  expect(read.data?.map((card): unknown => card.card_key)).toEqual(["apple", "date", "run"]);
  for (const card of read.data ?? []) {
    expect(card).toMatchObject({
      source: "import",
      template: "free",
      template_version: 2,
      back: [],
    });
    expect(Number(card.revision)).toBeGreaterThan(0);
  }
  expect(read.data?.[0]?.front).toEqual([
    expect.objectContaining({
      type: "senses",
      v: 2,
      payload: {
        term: "apple",
        ask: "term",
        senses: [
          {
            labels: [{ kind: "part_of_speech", category: "noun", text: "명" }],
            meaning: "사과",
            examples: ["an apple a day"],
          },
        ],
      },
    }),
  ]);
  expect(read.data?.[1]?.front).toEqual([
    expect.objectContaining({
      type: "senses",
      v: 2,
      payload: {
        term: "date",
        ask: "term",
        senses: [{ labels: [], meaning: "2026-10-29", examples: [] }],
      },
    }),
  ]);
});
