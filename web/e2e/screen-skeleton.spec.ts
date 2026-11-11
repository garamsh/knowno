import { randomUUID } from "node:crypto";

import { expect, type Page, test } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

// The local stack scripts/test-web.ts starts, whose URL and publishable key the app was built with.
const url = process.env.E2E_SUPABASE_URL;
const key = process.env.E2E_SUPABASE_KEY;
// Where to save each screen at 390 and 1280 px, for review; none is taken unless it names a directory.
const screenshots = process.env.E2E_SCREENSHOTS;
test.skip(
  !url || !key,
  "needs the local Supabase stack scripts/test-web.ts starts, which sets E2E_SUPABASE_URL and E2E_SUPABASE_KEY",
);

type Box = { left: number; right: number; top: number; bottom: number; height: number };

/** The shell's side menu is 240 px wide from 1024 px, and the page's gutter 20 px, 32 px from there. */
const gutterLeft = { 390: 20, 1280: 240 + 32 };

async function box(page: Page, selector: string, last = false): Promise<Box | null> {
  const slot = last ? page.locator(selector).last() : page.locator(selector).first();
  if ((await slot.count()) === 0) return null;
  const found = await slot.boundingBox();
  if (!found) return null;
  return {
    left: found.x,
    right: found.x + found.width,
    top: found.y,
    bottom: found.y + found.height,
    height: found.height,
  };
}

const screens = [
  { name: "record", path: "/record", topLevel: true, actions: false, search: false },
  { name: "notes", path: "/decks", topLevel: true, actions: true, search: true },
  { name: "note", path: "/decks/:deck", topLevel: false, actions: true, search: true },
  { name: "account", path: "/account", topLevel: true, actions: false, search: false },
];

test("draws 기록, 노트, a note and 설정 in one screen skeleton: the header's title and actions, the search at its height and the body, each on the gutters and a 16 px apart", async ({
  page,
  context,
  baseURL,
}) => {
  if (!url || !key || !baseURL) throw new Error("skipped above");
  const email = `web-screen-skeleton-${randomUUID()}@example.com`;
  const password = "web-screen-skeleton-password";
  const jar = new Map<string, string>();
  const auth = createServerClient(url, key, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (written) => {
        for (const { name, value } of written) jar.set(name, value);
      },
    },
  });
  const signUp = await auth.auth.signUp({ email, password });
  expect(signUp.error).toBeNull();
  const userId = signUp.data.user?.id;
  if (!userId) throw new Error("sign-up returned no fixture user");
  await context.addCookies([...jar].map(([name, value]) => ({ name, value, url: baseURL })));
  const db = createClient(url, key, { auth: { persistSession: false } });
  expect((await db.auth.signInWithPassword({ email, password })).error).toBeNull();

  const deckId = randomUUID();
  const time = new Date(Date.now() - 86_400_000).toISOString();
  expect(
    (
      await db.from("decks").insert({
        id: deckId,
        user_id: userId,
        name: "한국사",
        visibility: "private",
        created_at: time,
        updated_at: time,
      })
    ).error,
  ).toBeNull();
  expect(
    (
      await db.from("cards").insert(
        ["경국대전", "훈민정음", "직전법"].map((front) => ({
          id: randomUUID(),
          deck_id: deckId,
          user_id: userId,
          front: [{ type: "text", v: 3, id: "f", payload: { text: front } }],
          back: [],
          card_key: front,
          source: "manual",
          template: "free",
          template_version: 2,
          created_at: time,
          updated_at: time,
        })),
      )
    ).error,
  ).toBeNull();

  for (const screen of screens) {
    for (const width of [390, 1280] as const) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(screen.path.replace(":deck", deckId));
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      if (screenshots)
        await page.screenshot({ path: `${screenshots}/web-${screen.name}-${String(width)}.png` });

      const header = await box(page, '[data-slot="header"]');
      const search = await box(page, '[data-slot="search"]');
      const body = await box(page, '[data-slot="body"]');
      const title = await box(page, '[data-slot="header"] h1');
      // The last button is the ⋯ at the header's end, after the screen's own action.
      const actions = await box(page, '[data-slot="header"] button', true);
      const at = `${screen.name} at ${String(width)} px`;
      // The three slots exist, and the search only where the screen lists what the user made.
      expect.soft(header !== null && body !== null, `${at}: header and body`).toBe(true);
      expect.soft(search !== null, `${at}: search`).toBe(screen.search);
      expect.soft(actions !== null, `${at}: actions`).toBe(screen.actions);
      if (!header || !body || !title) continue;

      // Every slot starts on the gutter and the header and body end together.
      for (const [slot, slotBox] of [
        ["header", header],
        ["title", title],
        ["search", search],
        ["body", body],
      ] as const) {
        if (slotBox) expect.soft(slotBox.left, `${at}: ${slot} left`).toBe(gutterLeft[width]);
      }
      expect.soft(header.right, `${at}: header right`).toBe(body.right);
      if (search) {
        expect.soft(search.right, `${at}: search right`).toBe(body.right);
        expect.soft(search.height, `${at}: search height`).toBe(48);
      }

      // The slots follow one another 16 px apart.
      expect.soft((search ?? body).top - header.bottom, `${at}: under the header`).toBe(16);
      if (search) expect.soft(body.top - search.bottom, `${at}: under the search`).toBe(16);

      if (!actions) continue;
      expect.soft(actions.right, `${at}: actions end on the gutter`).toBe(body.right);
      if (screen.topLevel) {
        // The title and the actions share one line.
        expect
          .soft(Math.abs((title.top + title.bottom) / 2 - (actions.top + actions.bottom) / 2), at)
          .toBeLessThanOrEqual(1);
      } else {
        // The actions are a bar a tap target high above the title.
        const bar = await box(page, '[data-slot="header"] > div');
        expect.soft(bar?.height, `${at}: bar height`).toBe(44);
        expect.soft(actions.bottom <= title.top, `${at}: actions above the title`).toBe(true);
      }
    }
  }
});
