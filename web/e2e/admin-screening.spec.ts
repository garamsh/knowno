import { randomUUID } from "node:crypto";

import { type BrowserContext, expect, test } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

import { database, runSql } from "./database";

// The local stack scripts/test-web.ts starts, whose URL and publishable key the app was built with.
const url = process.env.E2E_SUPABASE_URL;
const key = process.env.E2E_SUPABASE_KEY;
test.skip(
  !url || !key || !database,
  "needs a throwaway local Supabase stack, which sets E2E_SUPABASE_URL, E2E_SUPABASE_KEY and E2E_DB_CONTAINER",
);

/** The admin host on the port the app answers (ADR 0178); `*.localhost` is the loopback. */
function adminOf(baseURL: string | undefined) {
  if (!baseURL) throw new Error("E2E_BASE_URL names the server the e2e specs run against");
  return `http://admin.localhost:${new URL(baseURL).port}`;
}

/** Signs a fresh account up, gives [context] its session on [origin], and returns a client as it. */
async function signUp(context: BrowserContext, origin: string, name: string) {
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
  const email = `web-screening-${name}-${randomUUID()}@example.com`;
  const password = "web-screening-test-password";
  const signup = await auth.auth.signUp({ email, password });
  expect(signup.error).toBeNull();
  const userId = signup.data.user?.id;
  if (!userId) throw new Error("sign-up returned no fixture user");
  await context.addCookies(
    [...jar].map(([cookie, value]) => ({ name: cookie, value, url: origin })),
  );
  const db = createClient(url, key, { auth: { persistSession: false } });
  await db.auth.signInWithPassword({ email, password });
  return { userId, db };
}

const contact = "문의는 010-1234-5678 로";

/**
 * A note [name] of [userId]'s held for [hold], as screening leaves it: public, hidden and `held`,
 * with a rules verdict flagging the phone number in its one card.
 */
async function hold(
  owner: Awaited<ReturnType<typeof signUp>>,
  name: string,
  heldFor: "ai" | "reports",
) {
  const deckId = randomUUID();
  const time = new Date(Date.now() - 86_400_000).toISOString();
  const deck = await owner.db.from("decks").insert({
    id: deckId,
    user_id: owner.userId,
    name,
    visibility: "private",
    created_at: time,
    updated_at: time,
  });
  expect(deck.error).toBeNull();
  const cardId = randomUUID();
  const card = await owner.db.from("cards").insert({
    id: cardId,
    deck_id: deckId,
    user_id: owner.userId,
    front: [{ type: "text", v: 1, id: "f", payload: { text: contact } }],
    back: [],
    card_key: contact,
    source: "manual",
    template: "free",
    template_version: 2,
    created_at: time,
    updated_at: time,
  });
  expect(card.error).toBeNull();
  const start = Array.from(contact).indexOf("0");
  // A verdict names a card by its hash, as the rules layer records it.
  runSql(
    `update public.decks set visibility = 'public', hidden = true, publication = 'held', published_at = now() where id = '${deckId}';
     insert into private.deck_screening (deck_id, hold) values ('${deckId}', '${heldFor}');
     insert into private.screening_verdicts (content_hash, layer, version, outcome, findings)
       select private.note_content_hash('${deckId}'), 'rules', 'e2e', 'refused',
         jsonb_build_array(jsonb_build_object(
           'card', private.card_hash(c.front, c.back, c.template, c.template_version),
           'where', 'front', 'block', 0, 'category', 'phone', 'start', ${String(start)}, 'end', ${String(start + 13)}))
       from public.cards as c where c.id = '${cardId}'
       on conflict do nothing;`,
  );
  return deckId;
}

const stored = async (owner: Awaited<ReturnType<typeof signUp>>, deckId: string) =>
  (await owner.db.from("decks").select("visibility, hidden, publication").eq("id", deckId).single())
    .data;

test("an admin sees a held note's findings with the words marked, lets one go public and keeps another hidden with a reason, and the database follows", async ({
  browser,
  baseURL,
}) => {
  const admin = adminOf(baseURL);
  const context = await browser.newContext();
  const adminUser = await signUp(context, admin, "admin");
  runSql(`insert into private.admins (user_id) values ('${adminUser.userId}')`);
  const owner = await signUp(await browser.newContext(), admin, "owner");
  const allowed = await hold(owner, "To allow", "ai");
  const kept = await hold(owner, "To keep", "reports");

  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${admin}/decks?view=held`);
  const queue = page.getByRole("list", { name: "검토 중인 노트" });
  const first = queue
    .getByRole("listitem")
    .filter({ has: page.getByRole("link", { name: "To allow" }) });
  await expect(first.locator("mark")).toHaveText("010-1234-5678");

  await first.getByRole("button", { name: "공개 허용", exact: true }).click();
  await first.getByRole("button", { name: "공개 허용", exact: true }).click();
  await expect(first).toBeHidden();
  expect(await stored(owner, allowed)).toEqual({
    visibility: "public",
    hidden: false,
    publication: "public",
  });

  const second = queue
    .getByRole("listitem")
    .filter({ has: page.getByRole("link", { name: "To keep" }) });
  await second.getByRole("button", { name: "숨김 유지", exact: true }).click();
  await expect(second.getByRole("button", { name: "숨김 유지", exact: true })).toBeDisabled();
  await second.getByRole("textbox", { name: "숨기는 이유" }).fill("연락처 노출");
  await second.getByRole("button", { name: "숨김 유지", exact: true }).click();
  await expect(second).toBeHidden();
  expect(await stored(owner, kept)).toMatchObject({
    visibility: "private",
    publication: "refused",
  });

  await page.goto(`${admin}/audit`);
  await expect(page.getByText("검토 중인 노트 공개 허용").first()).toBeVisible();
  await expect(page.getByText("검토 중인 노트 숨김 유지").first()).toBeVisible();
});

test("an admin adds a banned word, imports the bundled list without doubling it, and removes a word", async ({
  browser,
  baseURL,
}) => {
  const admin = adminOf(baseURL);
  const context = await browser.newContext();
  const adminUser = await signUp(context, admin, "terms");
  runSql(`insert into private.admins (user_id) values ('${adminUser.userId}')`);
  const word = `e2e-${randomUUID().slice(0, 8)}`;

  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${admin}/decks?view=terms`);
  await page.getByRole("textbox", { name: "금칙어 추가" }).fill(word);
  await page.getByRole("button", { name: "추가", exact: true }).click();
  const list = page.getByRole("list", { name: "금칙어 목록" });
  await expect(list.getByText(word, { exact: true })).toBeVisible();
  const before = await list.getByRole("listitem").count();

  await page.getByRole("button", { name: "기본 목록 불러오기", exact: true }).click();
  await page.getByRole("button", { name: "불러오기", exact: true }).click();
  const toast = page.getByText(/^금칙어 \d+개를 추가했어요\.$/u);
  await expect(toast).toBeVisible();
  const added = Number(/\d+/u.exec((await toast.textContent()) ?? "")?.[0]);
  const count = before + added;
  await expect(list.getByRole("listitem")).toHaveCount(count);
  await page.getByRole("button", { name: "기본 목록 불러오기", exact: true }).click();
  await page.getByRole("button", { name: "불러오기", exact: true }).click();
  await expect(page.getByText("목록의 금칙어가 이미 모두 들어 있어요.")).toBeVisible();
  await expect(list.getByRole("listitem")).toHaveCount(count);

  await list.getByRole("button", { name: `'${word}' 삭제`, exact: true }).click();
  await list.getByRole("button", { name: "삭제", exact: true }).click();
  await expect(list.getByText(word, { exact: true })).toBeHidden();
});
