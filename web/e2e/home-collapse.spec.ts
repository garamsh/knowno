import { randomUUID } from "node:crypto";

import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

import { overlaps } from "./overlap";

// The local stack scripts/test-web.ts starts, whose URL and publishable key the app was built with.
const url = process.env.E2E_SUPABASE_URL;
const key = process.env.E2E_SUPABASE_KEY;
test.skip(
  !url || !key,
  "needs a throwaway local Supabase stack, which sets E2E_SUPABASE_URL and E2E_SUPABASE_KEY",
);

/** Signs a fresh account up into [context] with a note of 30 cards due today and a week's study. */
async function seed(context: BrowserContext, baseURL: string) {
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
  const email = `web-home-collapse-${randomUUID()}@example.com`;
  const password = "web-home-collapse-password";
  const signup = await auth.auth.signUp({ email, password });
  expect(signup.error).toBeNull();
  const userId = signup.data.user?.id;
  if (!userId) throw new Error("sign-up returned no fixture user");
  await context.addCookies(
    [...jar].map(([cookie, value]) => ({ name: cookie, value, url: baseURL })),
  );
  const db = createClient(url, key, { auth: { persistSession: false } });
  await db.auth.signInWithPassword({ email, password });
  const day = 86_400_000;
  const time = new Date(Date.now() - 30 * day).toISOString();
  const deck = randomUUID();
  const decks = await db.from("decks").insert({
    id: deck,
    user_id: userId,
    name: "영단어 기본",
    visibility: "private",
    created_at: time,
    updated_at: time,
  });
  expect(decks.error).toBeNull();
  const text = (id: string, value: string) => ({
    type: "text",
    v: 1,
    id,
    payload: { text: value },
  });
  const cards = Array.from({ length: 30 }, (_, at) => ({
    id: randomUUID(),
    deck_id: deck,
    user_id: userId,
    front: [text("f", `word ${String(at)}`)],
    back: [text("b", `뜻 ${String(at)}`)],
    card_key: `word ${String(at)}`,
    source: "manual",
    template: "free",
    template_version: 2,
    created_at: time,
    updated_at: time,
  }));
  expect((await db.from("cards").insert(cards)).error).toBeNull();
  const states = await db.from("card_states").insert(
    cards.map((card) => ({
      user_id: userId,
      card_id: card.id,
      stability: 1,
      difficulty: 5,
      last_review: new Date(Date.now() - day).toISOString(),
      due: new Date(Date.now() - 3_600_000).toISOString(),
      updated_at: time,
    })),
  );
  expect(states.error).toBeNull();
  const reviews = Array.from({ length: 6 }, (_, back) =>
    cards.slice(0, 5 + back).map((card) => ({
      id: randomUUID(),
      card_id: card.id,
      user_id: userId,
      rating: "good",
      reviewed_at: new Date(Date.now() - (back + 1) * day).toISOString(),
      duration_ms: 3000,
      updated_at: time,
    })),
  ).flat();
  expect((await db.from("reviews").insert(reviews)).error).toBeNull();
}

/** The hero's heights once the page has hydrated it: at rest, its first screen's and its bar's. */
async function heights(page: Page) {
  const hero = page.getByRole("region", { name: "오늘 30장" });
  // The hero is pinned once its script has measured it.
  await expect.poll(() => hero.evaluate((element) => element.style.top)).not.toBe("");
  return await hero.evaluate((element: HTMLElement) => ({
    rest: element.offsetHeight,
    fill: parseFloat(getComputedStyle(element).minHeight),
    bar: element.offsetHeight + parseFloat(element.style.top),
  }));
}

/**
 * Scrolls the page to [y] as a script does, which the hero does not settle; resolves to where the
 * browser put it, to the device pixel.
 */
async function scrollTo(page: Page, y: number): Promise<number> {
  await page.evaluate((top) => {
    window.scrollTo({ top, behavior: "instant" });
  }, y);
  // Two frames: the scroll's, and the hero's drawing of it.
  await page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => {
          requestAnimationFrame(done);
        }),
      ),
  );
  return await page.evaluate(() => window.scrollY);
}

test("below 1024 px 홈's hero runs behind the top bar in its colour and collapses into a pinned bar with 시작, the week card going up beneath it; a release past half collapses it and one short of half expands it", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("skipped without local stack");
  test.setTimeout(120_000);
  await seed(context, baseURL);
  await page.setViewportSize({ width: 390, height: 844 });
  // The status bar's height on the 13 Pro, as the phone's tests lay it out.
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", {
    insets: { top: 47, bottom: 34, left: 0, right: 0 },
  });
  await page.goto("/");
  const hero = page.getByRole("region", { name: "오늘 30장" });
  const week = page.getByRole("region", { name: /일 연속$/ });
  await expect(week).toBeVisible();
  const directory = process.env.E2E_SCREENSHOTS;

  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await scrollTo(page, 0);
    const { rest, fill, bar } = await heights(page);
    const at = `in ${colorScheme}`;

    // The browser's bar takes the hero's colour below 1024 px, the page covering the screen.
    const theme = await page.evaluate(() => {
      const meta = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].find(
        (element) => !element.media || window.matchMedia(element.media).matches,
      );
      const probe = document.createElement("span");
      probe.style.color = "var(--color-hero)";
      document.body.append(probe);
      const resolved = getComputedStyle(probe).color;
      probe.style.color = meta?.content ?? "";
      const declared = getComputedStyle(probe).color;
      probe.remove();
      return {
        declared,
        resolved,
        viewport: document.querySelector('meta[name="viewport"]')?.getAttribute("content"),
      };
    });
    expect(theme.declared, at).toBe(theme.resolved);
    expect(theme.viewport, at).toContain("viewport-fit=cover");

    // At rest: the hero from the screen's top, its words under the status bar's inset, 시작 whole
    // on room for its edge, and no control over another or clipped.
    const top = await hero.boundingBox();
    const name = await hero.getByRole("heading", { name: "알아몰라", exact: true }).boundingBox();
    if (!top || !name) throw new Error(`the hero is drawn ${at}`);
    expect(top.y, at).toBe(0);
    expect(name.y, at).toBeGreaterThanOrEqual(47);
    expect(await overlaps(page), at).toEqual([]);
    if (directory)
      await page.screenshot({ path: `${directory}/${colorScheme}/web-home-collapse-0.png` });

    // Half way: still at the top, shorter by the scroll, its mascot smaller, the week card at its
    // foot.
    const half = rest - fill + (fill - bar) / 2;
    const halfScrolled = await scrollTo(page, half);
    const [halfway, mascot, card] = await Promise.all([
      hero.boundingBox(),
      hero.locator("img, svg").first().boundingBox(),
      week.boundingBox(),
    ]);
    if (!halfway || !mascot || !card) throw new Error(`홈 is drawn half collapsed ${at}`);
    expect(halfway.y + halfway.height, at).toBeCloseTo(rest - halfScrolled, 0);
    expect(mascot.width, at).toBeLessThan(210);
    expect(card.y, at).toBeCloseTo(halfway.y + halfway.height + 16, 0);
    if (directory)
      await page.screenshot({ path: `${directory}/${colorScheme}/web-home-collapse-half.png` });

    // Fully collapsed: a slim bar at the top with the day in a line and a compact 시작, whole on
    // room for its edge; the week card under it.
    await scrollTo(page, rest - bar);
    const start = hero.getByRole("link", { name: "시작", exact: true });
    await expect(start).toHaveCount(1);
    await expect(hero.getByText(/^오늘 30장 · \d+분$/)).toBeVisible();
    const [collapsed, link, under] = await Promise.all([
      hero.boundingBox(),
      start.boundingBox(),
      week.boundingBox(),
    ]);
    if (!collapsed || !link || !under) throw new Error(`홈 is drawn collapsed ${at}`);
    const shown = collapsed.y + collapsed.height;
    expect(shown, at).toBeCloseTo(bar, 0);
    expect(bar, at).toBeLessThan(fill / 3);
    expect(link.y, at).toBeGreaterThanOrEqual(47);
    expect(link.y + link.height + 7, at).toBeLessThanOrEqual(shown);
    expect(under.y, at).toBeCloseTo(shown + 16, 0);
    if (directory)
      await page.screenshot({ path: `${directory}/${colorScheme}/web-home-collapse-full.png` });
  }

  // A wheel the user turns: released short of half the collapse, the hero expands again; past
  // half, it collapses. Control: a script's scroll to the same place is left there.
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await scrollTo(page, 0);
  const { rest, fill, bar } = await heights(page);
  const collapse = rest - bar;
  await page.mouse.move(195, 400);
  // Turns the wheel by [distance] and waits until the page has scrolled from where it was, so a
  // wait on where it then rests does not pass before the wheel has acted.
  const wheel = async (distance: number) => {
    await page.evaluate(() => {
      const start = window.scrollY;
      document.body.dataset.moved = "";
      const moved = () => {
        if (window.scrollY === start) return;
        document.body.dataset.moved = "yes";
        window.removeEventListener("scroll", moved);
      };
      window.addEventListener("scroll", moved);
    });
    await page.mouse.wheel(0, distance);
    await expect.poll(() => page.evaluate(() => document.body.dataset.moved)).toBe("yes");
  };
  await wheel((fill - bar) * 0.3);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await wheel((fill - bar) * 0.7);
  await expect
    .poll(() => page.evaluate(() => Math.round(window.scrollY)))
    .toBe(Math.round(collapse));
  await scrollTo(page, 0);
  await scrollTo(page, Math.round((fill - bar) * 0.3));
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.scrollY)).toBe(Math.round((fill - bar) * 0.3));

  // From 1024 px the hero is not pinned and keeps the ground's colour in the browser's bar.
  await page.setViewportSize({ width: 1280, height: 900 });
  await scrollTo(page, 0);
  await expect.poll(() => hero.evaluate((element) => element.style.top)).toBe("");
  expect(
    await page.evaluate(() => {
      const meta = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].find(
        (element) => !element.media || window.matchMedia(element.media).matches,
      );
      return meta?.content.toLowerCase();
    }),
  ).toBe("#eef3ff");
});
