import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";

import { untilReacted } from "./until-reacted";

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
 * Each element that draws a hard edge under it (`--edge`) whose edge does not show whole: cut by
 * an ancestor that clips its overflow and ends inside the edge, or covered by an element that is
 * neither its ancestor nor its descendant (#637). Each is named by its tag, classes and text.
 */
async function cutEdges(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const cut: string[] = [];
    const name = (element: Element) =>
      `${element.tagName} "${element.textContent.trim().slice(0, 24)}" ${element.className}`;
    for (const element of document.querySelectorAll<HTMLElement>("body *")) {
      const edge = parseFloat(getComputedStyle(element).getPropertyValue("--edge"));
      if (!(edge > 0) || element.getClientRects().length === 0) continue;
      element.scrollIntoView({ block: "center", inline: "nearest" });
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.overflowX === "visible" && style.overflowY === "visible") continue;
        const clip = parent.getBoundingClientRect();
        if (box.bottom <= clip.bottom + 0.5 && box.bottom + edge > clip.bottom + 0.5) {
          cut.push(`${name(element)} cut by ${name(parent)}`);
        }
      }
      const y = box.bottom + edge / 2;
      for (const share of [0.25, 0.5, 0.75]) {
        const above = document.elementFromPoint(box.left + box.width * share, y);
        if (above && !above.contains(element) && !element.contains(above)) {
          cut.push(`${name(element)} covered by ${name(above)}`);
          break;
        }
      }
    }
    window.scrollTo(0, 0);
    return [...new Set(cut)];
  });
}

/**
 * Saves [page] at [widths], 390 and 1280 px unless named, in both themes under [name], when
 * E2E_SCREENSHOTS names a directory; at each, nothing reaches past the viewport's right edge.
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
      expect(await cutEdges(page), `${name} at ${String(width)} cuts an edge`).toEqual([]);
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

test.describe("signed out", () => {
  test("the service's /admin moves to the admin host, whose own sign-in opens there, and the service's sign-in stays", async ({
    page,
    baseURL,
  }) => {
    const { service, admin } = hostsOf(baseURL);
    const landed = await page.goto(`${service}/admin/users?q=kim`);
    await expect(page).toHaveURL(`${admin}/login`);
    // The way here: the permanent move to the same path on the admin host, then its sign-in.
    const moved = landed?.request().redirectedFrom()?.redirectedFrom();
    expect(moved?.url()).toBe(`${service}/admin/users?q=kim`);
    expect((await moved?.response())?.status()).toBe(308);
    expect(landed?.request().redirectedFrom()?.url()).toBe(`${admin}/users?q=kim`);

    await expect(
      page.getByRole("heading", { level: 1, name: "관리자 로그인", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Google로 로그인", exact: true })).toBeEnabled();
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await capture(page, "admin-sign-in");

    await page.goto(`${admin}/login?error=cancelled`);
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      "로그인이 취소되었어요. 다시 시도해 주세요.",
    );

    // Control: the service's own sign-in is unchanged, on the service's host.
    await page.goto(`${service}/`);
    await expect(page).toHaveURL(`${service}/login`);
    await expect(page.getByRole("heading", { name: "알아몰라", exact: true })).toBeVisible();
  });
});

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

test.describe("signed in", () => {
  test.skip(
    !url || !key || !database,
    "needs a throwaway local Supabase stack, which sets E2E_SUPABASE_URL, E2E_SUPABASE_KEY and E2E_DB_CONTAINER",
  );

  test("an admin gets the admin shell and none of the service's pages on the admin host, signed in there alone", async ({
    browser,
    baseURL,
  }) => {
    const { service, admin } = hostsOf(baseURL);
    const context = await browser.newContext();
    const { userId, email } = await signUp(context, [admin], "admin");
    makeAdmin(userId);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.goto(`${admin}/`);
    await expect(
      page.getByRole("heading", { level: 1, name: "처리할 일", exact: true }),
    ).toBeVisible();
    const menu = page.getByRole("navigation", { name: "관리 메뉴", exact: true });
    await expect(menu.getByRole("link")).toHaveText([
      "처리할 일",
      "사용자",
      "노트",
      "AI",
      "요금제",
      "관리자",
    ]);
    await expect(menu.getByRole("link", { name: "처리할 일" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByRole("navigation", { name: "주 메뉴" })).toHaveCount(0);
    await expect(page.getByText(email, { exact: true }).first()).toBeVisible();
    await capture(page, "admin-shell");

    await untilReacted(
      () => menu.getByRole("link", { name: "사용자", exact: true }).click(),
      () => Promise.resolve(page.url() === `${admin}/users`),
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "사용자", exact: true }),
    ).toBeVisible();
    await expect(menu.getByRole("link", { name: "사용자", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );

    // Below 1024 px the menu is a full screen, which a section's link closes as it opens it.
    await page.setViewportSize({ width: 390, height: 844 });
    const menuScreen = page.getByRole("dialog", { name: "관리 메뉴" });
    await untilReacted(
      () => page.getByRole("button", { name: "메뉴", exact: true }).click(),
      () => menuScreen.isVisible(),
    );
    await expect(menuScreen).toHaveJSProperty("offsetWidth", 390);
    await capture(page, "admin-menu", [390]);
    await page.setViewportSize({ width: 390, height: 844 });
    await menuScreen.getByRole("link", { name: "노트", exact: true }).click();
    await expect(page).toHaveURL(`${admin}/decks`);
    await expect(menuScreen).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name: "노트", exact: true })).toBeVisible();
    // The menu left no entry of its own behind: the back returns to the section before.
    await page.goBack();
    await expect(page).toHaveURL(`${admin}/users`);

    // Each page of the service is looked for in the admin area, and is not there.
    for (const path of ["/record", "/account", "/study", "/terms", "/oauth/consent"]) {
      const response = await page.goto(`${admin}${path}`);
      expect(response?.status(), path).toBe(404);
      await expect(page.getByText("찾는 페이지가 없어요", { exact: true })).toBeVisible();
    }

    // The admin host's session is its own: the service's host is still signed out.
    await page.goto(`${service}/`);
    await expect(page).toHaveURL(`${service}/login`);

    // 로그아웃 ends the admin host's session and opens its sign-in.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${admin}/`);
    await untilReacted(
      () => page.getByRole("button", { name: "로그아웃", exact: true }).click(),
      () => Promise.resolve(page.url() === `${admin}/login`),
    );
    await page.goto(`${admin}/users`);
    await expect(page).toHaveURL(`${admin}/login`);
    await context.close();
  });

  test("an admin pages through every user, sized and filtered above the table, opens one beside it, and every section draws each edge whole", async ({
    browser,
    baseURL,
  }) => {
    const { admin } = hostsOf(baseURL);
    const context = await browser.newContext();
    const { userId } = await signUp(context, [admin], "sections");
    makeAdmin(userId);
    // 25 users of this run alone, newest first from -01, -03 suspended and -02 on Pro.
    const tag = randomUUID().slice(0, 8);
    runSql(`insert into auth.users (id, email, created_at, is_anonymous, aud, role)
      select gen_random_uuid(), format('w651-${tag}-%s@example.com', lpad(n::text, 2, '0')),
        now() - n * interval '1 minute', false, 'authenticated', 'authenticated'
      from generate_series(1, 25) as n`);
    runSql(`insert into private.suspensions (user_id, reason)
      select id, 'e2e' from auth.users where email = 'w651-${tag}-03@example.com'`);
    runSql(`insert into private.user_plans (user_id, plan, version_id)
      select u.id, 'pro', (select v.id from private.plan_versions as v
        where v.plan = 'pro' and v.starts_at <= now() order by v.starts_at desc, v.id desc limit 1)
      from auth.users as u where u.email = 'w651-${tag}-02@example.com'`);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    const table = page.getByRole("table", { name: "사용자 목록", exact: true });
    const emails = table.getByRole("link");
    const pager = page.getByRole("navigation", { name: "사용자 페이지", exact: true });

    await page.goto(`${admin}/users?q=${tag}`);
    await expect(emails).toHaveCount(20);
    await expect(emails.first()).toHaveText(`w651-${tag}-01@example.com`);
    await expect(pager.getByText("1–20 / 25", { exact: true })).toBeVisible();
    await capture(page, "admin-users");

    await pager.getByRole("link", { name: "2페이지", exact: true }).click();
    await expect(page).toHaveURL(`${admin}/users?q=${tag}&page=2`);
    await expect(emails).toHaveCount(5);
    await expect(pager.getByText("21–25 / 25", { exact: true })).toBeVisible();

    await page.getByRole("combobox", { name: "몇 명씩 보기", exact: true }).selectOption("50");
    await expect(page).toHaveURL(`${admin}/users?q=${tag}&size=50`);
    await expect(emails).toHaveCount(25);
    await expect(pager.getByText("1–25 / 25", { exact: true })).toBeVisible();

    await page.getByRole("combobox", { name: "상태", exact: true }).selectOption("suspended");
    await expect(page).toHaveURL(`${admin}/users?q=${tag}&status=suspended&size=50`);
    await expect(emails).toHaveText([`w651-${tag}-03@example.com`]);
    await page.getByRole("combobox", { name: "상태", exact: true }).selectOption("");
    await page.getByRole("combobox", { name: "요금제", exact: true }).selectOption("pro");
    await expect(page).toHaveURL(`${admin}/users?q=${tag}&plan=pro&size=50`);
    await expect(emails).toHaveText([`w651-${tag}-02@example.com`]);

    // The search applies once the typing pauses, on the first page, keeping the filters.
    const search = page.getByRole("searchbox", { name: "이메일로 찾기", exact: true });
    await search.fill(`${tag}-0`);
    await expect(page).toHaveURL(`${admin}/users?q=${tag}-0&plan=pro&size=50`);
    await page.getByRole("combobox", { name: "요금제", exact: true }).selectOption("");
    await expect(emails).toHaveCount(9);

    // A row opens its user beside the list from 1024 px, and in the list's place below it.
    const chosen = `w651-${tag}-02@example.com`;
    await page.getByRole("row", { name: chosen }).click({ position: { x: 600, y: 10 } });
    const panel = page.getByRole("complementary", { name: chosen, exact: true });
    await expect(panel.getByRole("heading", { level: 2, name: chosen, exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/users\\?q=${tag}-0&size=50&user=`));
    await expect(table).toBeVisible();
    const [listBox, panelBox] = [await table.boundingBox(), await panel.boundingBox()];
    expect((panelBox?.x ?? 0) > (listBox?.x ?? 0) + (listBox?.width ?? 0) - 1).toBe(true);
    await panel.getByText("요금제 바꾸기", { exact: true }).click();
    await expect(panel.getByRole("button", { name: "무료로 되돌리기", exact: true })).toBeVisible();
    await capture(page, "admin-user-panel");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(table).toBeHidden();
    await expect(panel).toBeVisible();
    await panel.getByRole("link", { name: "목록으로", exact: true }).click();
    await expect(page).toHaveURL(`${admin}/users?q=${tag}-0&size=50`);
    await expect(table).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 900 });

    // The user's own page, with 요금제 바꾸기 open over 무료로 되돌리기 (#637).
    await page.goto(`${admin}/users?q=${chosen}`);
    await emails.first().click();
    await panel.getByRole("link", { name: "전체 화면으로", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: chosen, exact: true })).toBeVisible();
    await page.getByText("요금제 바꾸기", { exact: true }).click();
    await capture(page, "admin-user");

    for (const [path, heading, name] of [
      ["/", "처리할 일", "admin-todo"],
      ["/decks", "노트", "admin-notes"],
      ["/decks?view=public", "노트", "admin-notes-public"],
      ["/ai", "AI", "admin-ai"],
      ["/settings/ai", "AI", "admin-ai-settings"],
      ["/plans", "요금제", "admin-plans"],
      ["/admins", "관리자", "admin-admins"],
    ] as const) {
      await page.goto(`${admin}${path}`);
      await expect(
        page.getByRole("heading", { level: 1, name: heading, exact: true }),
      ).toBeVisible();
      await capture(page, name);
    }
    await context.close();
  });

  test("an account that is not an admin gets one line on the admin host, and the service as before", async ({
    browser,
    baseURL,
  }) => {
    const { service, admin } = hostsOf(baseURL);
    const context = await browser.newContext();
    await signUp(context, [admin, service], "user");
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.goto(`${admin}/users`);
    await expect(
      page.getByRole("heading", { level: 1, name: "관리자만 들어올 수 있어요.", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "다른 계정으로 로그인", exact: true }),
    ).toBeVisible();
    await capture(page, "admin-refused");

    // Control: the same account on the service's host has its home in the service's shell.
    await page.goto(`${service}/`);
    await expect(page).toHaveURL(`${service}/`);
    await expect(page.getByRole("navigation", { name: "주 메뉴" }).first()).toBeAttached();

    await page.goto(`${admin}/`);
    await untilReacted(
      () => page.getByRole("button", { name: "다른 계정으로 로그인", exact: true }).click(),
      () => Promise.resolve(page.url() === `${admin}/login`),
    );
    await context.close();
  });
});
