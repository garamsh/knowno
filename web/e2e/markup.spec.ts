import { randomUUID } from "node:crypto";

import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

import { addByHand } from "./add-by-hand";

// The local stack scripts/test-web.ts starts, whose URL and publishable key the app was built with.
const url = process.env.E2E_SUPABASE_URL;
const key = process.env.E2E_SUPABASE_KEY;
// Where to save the pages in both themes at 390 and 1280 px, for review; none is taken unless it
// names a directory.
const screenshots = process.env.E2E_SCREENSHOTS;
test.skip(
  !url || !key,
  "needs a throwaway local Supabase stack, which sets E2E_SUPABASE_URL and E2E_SUPABASE_KEY",
);

/** Saves [page] as it is, in both themes at both widths, and leaves it at the phone's. */
async function shoot(page: Page, name: string) {
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `${name} at ${String(width)} px`,
      ).toBe(true);
      if (screenshots)
        await page.screenshot({
          path: `${screenshots}/${colorScheme}/web-markup-${name}-${String(width)}.png`,
        });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
}

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
  const email = `web-markup-${randomUUID()}@example.com`;
  const password = "web-markup-test-password";
  const signup = await auth.auth.signUp({ email, password });
  expect(signup.error).toBeNull();
  const userId = signup.data.user?.id;
  if (!userId) throw new Error("sign-up returned no fixture user");
  await context.addCookies([...jar].map(([name, value]) => ({ name, value, url: baseURL })));
  const db = createClient(url, key, { auth: { persistSession: false } });
  await db.auth.signInWithPassword({ email, password });
  return { db, userId };
}

const text = (v: number, id: string, front: string, back: string) => ({
  type: "text",
  v,
  id,
  payload: { front, back },
});
const cloze = (id: string, payload: Record<string, unknown>, v = 2) => ({
  type: "cloze",
  v,
  id,
  payload,
});

/** A note of cards stored as a build that writes markup writes them, and the signed-in client. */
async function seededNote(context: BrowserContext, baseURL: string) {
  const { db, userId } = await signUp(context, baseURL);
  const deckId = randomUUID();
  const time = new Date(Date.now() - 86_400_000).toISOString();
  expect(
    (
      await db.from("decks").insert({
        id: deckId,
        user_id: userId,
        name: "마크업 노트",
        visibility: "private",
        created_at: time,
        updated_at: time,
      })
    ).error,
  ).toBeNull();
  const row = (front: unknown[], cardKey: string, age: number) => ({
    id: randomUUID(),
    deck_id: deckId,
    user_id: userId,
    front,
    back: [],
    card_key: cardKey,
    source: "manual",
    template: "free",
    template_version: 2,
    created_at: new Date(Date.now() - age * 1000).toISOString(),
    updated_at: new Date(Date.now() - age * 1000).toISOString(),
  });
  expect(
    (
      await db.from("cards").insert([
        row(
          [
            text(
              3,
              "m1",
              "**Paris** is the *capital*\nof `France`",
              "- the Seine\n- the Louvre\n  - the Mona Lisa\n1. one\n2. two",
            ),
          ],
          "paris is the capital\nof france",
          5,
        ),
        row([text(2, "m2", "2*3*4 = 24", "- not a list")], "2*3*4 = 24", 4),
        row(
          [
            cloze("m3", {
              text: "{{c1::Paris::city}} is the capital of {{c2::France}}\nwith {{c1::2 million}} people",
            }),
          ],
          "paris is the capital of france\nwith 2 million people",
          3,
        ),
        row([cloze("m4", { text: "no cloze in this one" })], "no cloze in this one", 2),
      ])
    ).error,
  ).toBeNull();
  return { db, deckId };
}

test("draws a 글 of version 3 and a cloze of version 2 in the note's list and in study, and leaves the old ones as written", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("skipped without local stack");
  const { deckId } = await seededNote(context, baseURL);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/decks/${deckId}`);
  await expect(page.getByRole("heading", { name: "마크업 노트", exact: true })).toBeVisible();
  const list = page.getByRole("region", { name: "카드" });
  // A version 3 글: bold, italic and code, each line of the text on a line of its own.
  const markup = list.getByRole("button", { name: /^Paris is the capital/ });
  await expect(markup.locator("strong")).toHaveText("Paris");
  await expect(markup.locator("em")).toHaveText("capital");
  await expect(markup.locator("code")).toHaveText("France");
  // The front is one paragraph with a line break, the back a bulleted list with a nested item and
  // a numbered one: six lines.
  await expect(markup.locator("[data-markup]")).toHaveCount(6);
  await expect(markup.locator("br")).toHaveCount(1);
  // A version 2 글 stays as it was written, its asterisks and its hyphen.
  const literal = list.getByRole("button", { name: /^2\*3\*4 = 24/ });
  await expect(literal.locator("em")).toHaveCount(0);
  await expect(literal).toContainText("- not a list");
  // A cloze of version 2 shows its spans filled on the hatch, a cloze of none as a placeholder.
  const anki = list.getByRole("button", { name: /^빈칸 is the capital of 빈칸/ });
  await expect(anki.locator('[data-blank="marked"]')).toHaveText(["Paris", "France", "2 million"]);
  await expect(anki).not.toContainText("{{");
  await expect(list).toContainText("[이 버전에서 표시할 수 없는 내용: cloze]");
  await shoot(page, "list");

  // Study draws each in its place: the cloze's spans boxes on the hatch, a hint in its box.
  await page.goto(`/study?decks=${deckId}`);
  const study = page.getByRole("region", { name: "현재 카드" });
  await expect(study).toBeVisible();
  const seen = new Set<string>();
  for (let count = 0; count < 3; count++) {
    const current = study.locator("[data-blank], [data-markup], p").first();
    await expect(current).toBeVisible();
    seen.add((await study.textContent()) ?? "");
    await shoot(page, `study-${String(count + 1)}`);
    await page.keyboard.press("ArrowRight");
    await expect(page.getByText(`${String(count + 1)}/`)).toBeVisible();
  }
  expect(seen.size).toBeGreaterThan(1);
});

test("writes Markdown as version 3 and Anki's cloze as version 2, keeps an old 글 until it is edited, and turns a pasted table into a 표", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("skipped without local stack");
  const { db, deckId } = await seededNote(context, baseURL);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/decks/${deckId}`);
  await addByHand(page);
  await page.getByRole("button", { name: "직접 입력" }).click();
  const dialog = page.getByRole("dialog", { name: "새 카드" });
  const front = dialog.getByRole("textbox", { name: "앞면", exact: true });
  // Typing "- " and a line break goes on with the list; the formatting shows under the field.
  await front.pressSequentially("Shopping **list**\n- eggs\nmilk");
  await expect(front).toHaveValue("Shopping **list**\n- eggs\n- milk");
  const preview = dialog.getByRole("group", { name: "미리 보기" });
  await expect(preview.locator("strong")).toHaveText("list");
  await expect(preview.locator("[data-markup]")).toHaveCount(3);
  await dialog.getByRole("textbox", { name: "뒷면", exact: true }).fill("`2 + 2` is 4");
  await shoot(page, "editor-text");

  // A pasted Markdown table becomes a 표 in the place of the empty 글 it was pasted into.
  await dialog.getByRole("button", { name: "+ 칸 추가" }).click();
  await page
    .getByRole("dialog", { name: "칸 추가" })
    .getByRole("button", { name: "글", exact: true })
    .click();
  const second = dialog.getByRole("textbox", { name: "앞면", exact: true }).nth(1);
  await second.focus();
  await page.evaluate(() => {
    const field = document.activeElement;
    const data = new DataTransfer();
    data.setData("text/plain", "| 나라 | 수도 |\n| --- | --- |\n| 일본 | 도쿄 |");
    field?.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
  await expect(dialog.getByRole("heading", { name: "표" })).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "1열 머리글" })).toHaveValue("나라");
  await expect(dialog.getByRole("textbox", { name: "2행 2열" })).toHaveCount(0);
  await expect(dialog.getByRole("textbox", { name: "1행 2열" })).toHaveValue("도쿄");
  await dialog.getByRole("textbox", { name: "1행 2열" }).click();
  await dialog.getByRole("button", { name: "빈칸", exact: true }).click();

  // A 빈칸 문장 is Anki's syntax, "가리기" taking the next free number.
  await dialog.getByRole("button", { name: "+ 칸 추가" }).click();
  await page
    .getByRole("dialog", { name: "칸 추가" })
    .getByRole("button", { name: "빈칸 문장", exact: true })
    .click();
  const line = dialog.getByRole("textbox", { name: "문장", exact: true });
  await line.fill("Tokyo is the capital of Japan");
  // Each word is selected by the keys: Tokyo from the start, Japan back from the end.
  for (const [edge, key] of [
    ["Home", "ArrowRight"],
    ["End", "ArrowLeft"],
  ] as const) {
    await line.press(edge);
    for (let letter = 0; letter < 5; letter++) await line.press(`Shift+${key}`);
    await dialog.getByRole("button", { name: "가리기", exact: true }).click();
  }
  await expect(line).toHaveValue("{{c1::Tokyo}} is the capital of {{c2::Japan}}");
  await shoot(page, "editor-cloze");
  await dialog.getByRole("button", { name: "저장", exact: true }).click();
  await expect(dialog).toBeHidden();

  const written = await db
    .from("cards")
    .select("front")
    .eq("deck_id", deckId)
    .like("card_key", "shopping%");
  expect(written.error).toBeNull();
  const front0 = written.data?.[0]?.front as { type: string; v: number; payload: unknown }[];
  expect(front0.map(({ type, v }) => [type, v])).toEqual([
    ["text", 3],
    ["table", 2],
    ["cloze", 2],
  ]);
  expect(front0[0]?.payload).toEqual({
    front: "Shopping **list**\n- eggs\n- milk",
    back: "`2 + 2` is 4",
  });
  expect(front0[2]?.payload).toEqual({ text: "{{c1::Tokyo}} is the capital of {{c2::Japan}}" });

  // An old 글 opens as written, is stored as it was while unchanged, and as version 3 once edited
  // with its text through the escape, so the asterisks stay asterisks.
  const list = page.getByRole("region", { name: "카드" });
  await list.getByRole("button", { name: /^2\*3\*4 = 24/ }).click();
  const editor = page.getByRole("dialog", { name: "카드 편집" });
  const old = editor.getByRole("textbox", { name: "앞면", exact: true });
  await expect(old).toHaveValue("2*3*4 = 24");
  await expect(editor.getByRole("group", { name: "미리 보기" })).toHaveCount(0);
  await editor.getByRole("button", { name: "저장", exact: true }).click();
  await expect(editor).toBeHidden();
  const unchanged = await db
    .from("cards")
    .select("front")
    .eq("deck_id", deckId)
    .eq("card_key", "2*3*4 = 24");
  expect((unchanged.data?.[0]?.front as { v: number }[])[0]?.v).toBe(2);
  await list.getByRole("button", { name: /^2\*3\*4 = 24/ }).click();
  await editor.getByRole("textbox", { name: "앞면", exact: true }).fill("2*3*4 = 24!");
  await editor.getByRole("button", { name: "저장", exact: true }).click();
  await expect(editor).toBeHidden();
  const edited = await db
    .from("cards")
    .select("front")
    .eq("deck_id", deckId)
    .like("card_key", "2*3*4 = 24!%");
  expect(edited.data?.[0]?.front).toMatchObject([
    { type: "text", v: 3, payload: { front: "2\\*3\\*4 = 24!", back: "\\- not a list" } },
  ]);
  await expect(list.getByRole("button", { name: /^2\*3\*4 = 24!/ }).locator("em")).toHaveCount(0);
});
