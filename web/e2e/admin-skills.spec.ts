import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

import { overlaps } from "./overlap";

/**
 * The service and its admin host on the port the app answers (ADR 0178). `*.localhost` is the
 * loopback in the browser, so the admin host needs no DNS. The server is given the service's as
 * `KNOWNO_SERVICE_ORIGIN`, so it names these two hosts.
 */
function hostsOf(baseURL: string | undefined) {
  if (!baseURL) throw new Error("E2E_BASE_URL names the server the e2e specs run against");
  const { port } = new URL(baseURL);
  return { service: `http://localhost:${port}`, admin: `http://admin.localhost:${port}` };
}

/**
 * Saves [page] at [widths], 390 and 1280 px unless named, in both themes under [name], when
 * E2E_SCREENSHOTS names a directory; at each, nothing reaches past the viewport's right edge and
 * no control overlaps another or is clipped.
 */
async function capture(page: Page, name: string, widths: readonly number[] = [390, 1280]) {
  const directory = process.env.E2E_SCREENSHOTS;
  for (const width of widths) {
    const height = width < 1024 ? 844 : 900;
    await page.setViewportSize({ width, height });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      // The theme's own lockup is a lazy image the switch has just shown.
      await page.waitForFunction(() =>
        [...document.images].every((image) => image.offsetParent === null || image.complete),
      );
      expect(
        await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>("body *")]
            .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 0.5)
            .map((element) => `${element.tagName} ${element.className}`),
        ),
        `${name} at ${String(width)} scrolls sideways`,
      ).toEqual([]);
      // Soft, so one run names every page that overlaps.
      expect.soft(await overlaps(page), `${name} at ${String(width)} overlaps`).toEqual([]);
      if (directory)
        await page.screenshot({
          path: `${directory}/${colorScheme}/web-${name}-${String(width)}.png`,
          fullPage: true,
          scale: "css",
        });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
}

// The local stack scripts/test-web.ts starts, whose URL and publishable key the app was built with,
// and its database's container, where an admin is made as the PM makes the first one.
const url = process.env.E2E_SUPABASE_URL;
const key = process.env.E2E_SUPABASE_KEY;
const database = process.env.E2E_DB_CONTAINER;

/** Signs a fresh account up and gives [context] its session on the hosts [origins]. */
async function signUp(context: BrowserContext, origins: string[], name: string) {
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
  const email = `web-admin-${name}-${randomUUID()}@example.com`;
  const signup = await auth.auth.signUp({ email, password: "web-admin-test-password" });
  expect(signup.error).toBeNull();
  const userId = signup.data.user?.id;
  if (!userId) throw new Error("sign-up returned no fixture user");
  await context.addCookies(
    origins.flatMap((origin) =>
      [...jar].map(([cookie, value]) => ({ name: cookie, value, url: origin })),
    ),
  );
  return { userId, email };
}

/** Makes [userId] an admin, the row the PM inserts for the first admin (ADR 0070). */
function makeAdmin(userId: string) {
  runSql(`insert into private.admins (user_id) values ('${userId}')`);
}

/** Runs [sql] in the stack's database as its superuser. */
function runSql(sql: string) {
  if (!database) throw new Error("skipped without local stack");
  execFileSync(
    "docker",
    ["exec", database, "psql", "-U", "supabase_admin", "-d", "postgres"].concat([
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ]),
  );
}

test.skip(
  !url || !key || !database,
  "needs a throwaway local Supabase stack, which sets E2E_SUPABASE_URL, E2E_SUPABASE_KEY and E2E_DB_CONTAINER",
);

/** A client signed in as [email], whose `card_form_skills()` is what the assistant serves them. */
async function clientOf(email: string) {
  if (!url || !key) throw new Error("skipped without local stack");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const signed = await client.auth.signInWithPassword({
    email,
    password: "web-admin-test-password",
  });
  expect(signed.error).toBeNull();
  return client;
}

/** The text of [form]'s skill as the client's user is served it. */
async function served(client: Awaited<ReturnType<typeof clientOf>>, form: string) {
  const read = await client.rpc("card_form_skills");
  expect(read.error).toBeNull();
  return (read.data as { form: string; text: string }[]).find((skill) => skill.form === form)?.text;
}

test("an admin writes a card form's skill as a draft that only admins are served, then applies it to everyone", async ({
  browser,
  baseURL,
}) => {
  const { admin } = hostsOf(baseURL);
  const context = await browser.newContext();
  const owner = await signUp(context, [admin], "skills");
  makeAdmin(owner.userId);
  const visitor = await signUp(await browser.newContext(), [admin], "visitor");
  const ownerClient = await clientOf(owner.email);
  const visitorClient = await clientOf(visitor.email);
  const seed = await served(visitorClient, "cloze");
  expect(seed).toContain("# cloze");

  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${admin}/assistant?skill=cloze`);
  await expect(page.getByRole("heading", { level: 1, name: "말랑이", exact: true })).toBeVisible();
  const list = page.getByRole("list", { name: "카드 형식 스킬", exact: true });
  await expect(list.getByRole("link")).toHaveCount(6);
  await expect(page.getByRole("region", { name: "빈칸 문장 · 사용 중인 스킬" })).toBeVisible();
  await capture(page, "admin-skills-in-use");

  const edit = page.getByRole("form", { name: "빈칸 문장 새 버전", exact: true });
  const guide = edit.getByRole("textbox", { name: /가이드/ });
  await expect(guide).toHaveValue(seed ?? "");
  await guide.fill(`${seed ?? ""}\n- An e2e rule: blank nothing twice.`);
  await edit.getByRole("textbox", { name: "메모" }).fill("e2e");
  await edit.getByRole("button", { name: "초안으로 저장", exact: true }).click();
  const panel = page.getByRole("region", { name: "빈칸 문장 · 초안 (관리자만 테스트 중)" });
  await expect(panel).toBeVisible();
  await panel.getByText(/^빈칸 문장 스킬 v\d+ → v\d+ 다른 점$/).click();
  await expect(panel.getByText("An e2e rule: blank nothing twice.").first()).toBeVisible();
  await capture(page, "admin-skills-draft");

  // Tried: admins are served the draft, everyone else the version in use.
  expect(await served(ownerClient, "cloze")).toContain("An e2e rule");
  expect(await served(visitorClient, "cloze")).toBe(seed);

  await panel.getByRole("button", { name: "모두에게 적용", exact: true }).click();
  await page.getByRole("button", { name: "적용", exact: true }).click();
  await expect(page.getByRole("region", { name: "빈칸 문장 · 사용 중인 스킬" })).toBeVisible();
  expect(await served(visitorClient, "cloze")).toContain("An e2e rule");
  await capture(page, "admin-skills-applied");

  await page.goto(`${admin}/audit`);
  await expect(page.getByText("카드 형식 스킬 적용").first()).toBeVisible();
});
