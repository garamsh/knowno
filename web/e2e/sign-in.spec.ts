import { expect, type Page, test } from "@playwright/test";

import { untilReacted } from "./until-reacted";

/** The ground's colour in each theme, the body's background (globals.css). */
const ground = { light: "rgb(239, 250, 246)", dark: "rgb(16, 37, 31)" };

/**
 * Records the body's background at the moment the parser inserts the body, before anything in
 * it can be painted, in the session storage's `firstBodyBackground`.
 */
async function recordFirstBodyBackground(page: Page) {
  await page.addInitScript(() => {
    new MutationObserver((_, observer) => {
      const body = document.querySelector("body");
      if (!body) return;
      sessionStorage.setItem("firstBodyBackground", getComputedStyle(body).backgroundColor);
      observer.disconnect();
    }).observe(document, { childList: true, subtree: true });
  });
}

test.describe("signed out", () => {
  test("opening the app lands on /login, which offers Google sign-in", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "알아몰라", exact: true })).toBeVisible();
    await expect(
      page.getByText("계속하면 이용약관과 개인정보 처리방침에 동의하는 것으로 봐요.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Google로 로그인", exact: true })).toBeEnabled();
  });

  test("Google sign-in leaves for Supabase Auth with this origin's /auth/callback", async ({
    page,
  }) => {
    const authorize = /\/auth\/v1\/authorize\?/;
    const requested: string[] = [];
    page.on("request", (request) => {
      if (authorize.test(request.url())) requested.push(request.url());
    });
    // The request is stopped here: the real Google consent screen is not part of the test.
    await page.route(authorize, (route) => route.abort());
    await page.goto("/login");
    const origin = new URL(page.url()).origin;

    await untilReacted(
      () => page.getByRole("button", { name: "Google로 로그인", exact: true }).click(),
      () => Promise.resolve(requested.length > 0),
    );

    const url = new URL(requested[0] ?? "");
    expect(url.searchParams.get("provider")).toBe("google");
    expect(url.searchParams.get("redirect_to")).toBe(`${origin}/auth/callback`);
  });

  for (const [path, title, last, anchor] of [
    ["/terms", "이용약관", "시행일", "effective"],
    ["/privacy", "개인정보 처리방침", "시행일과 변경", "changes"],
  ] as const) {
    test(`${path} shows ${title} without a session, its contents leading to each section`, async ({
      page,
    }) => {
      await page.goto(path);

      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole("heading", { level: 1, name: title, exact: true })).toBeVisible();
      const toc = page.getByRole("navigation", { name: "목차", exact: true });
      await toc.getByRole("link", { name: last, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${path}#${anchor}$`));
      await expect(
        page.getByRole("heading", { level: 2, name: last, exact: true }),
      ).toBeInViewport();
    });
  }

  test("the theme follows the system's dark mode", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/login");
    await expect(page.locator("body")).toHaveCSS("background-color", ground.light);

    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("body")).toHaveCSS("background-color", ground.dark);
  });

  test("Google's button takes the guidelines' light colours and G mark in light, and the dark in dark", async ({
    page,
  }) => {
    const button = page.getByRole("button", { name: "Google로 로그인", exact: true });
    const guidelines = {
      light: { fill: "rgb(255, 255, 255)", stroke: "rgb(116, 119, 117)", label: "rgb(31, 31, 31)" },
      dark: { fill: "rgb(19, 19, 20)", stroke: "rgb(142, 145, 143)", label: "rgb(227, 227, 227)" },
    };
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/login");

      await expect(button).toHaveCSS("background-color", guidelines[theme].fill);
      await expect(button).toHaveCSS("border-top-color", guidelines[theme].stroke);
      await expect(button).toHaveCSS("border-top-width", "1px");
      await expect(button).toHaveCSS("color", guidelines[theme].label);
      await expect(button).toHaveCSS("font-size", "14px");
      await expect(button).toHaveCSS("padding-left", "12px");
      await expect(button).toHaveCSS("column-gap", "10px");
      const mark = button.locator(`img[src="/google/g-mark-${theme}.png"]`);
      await expect(mark).toBeVisible();
      await expect(button.locator("img:visible")).toHaveCount(1);
      expect(await mark.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(80);
      expect(await mark.boundingBox()).toMatchObject({ width: 20, height: 20 });
    }
  });

  test("a stored theme choice draws every page's first paint in it, whatever the system's", async ({
    page,
  }) => {
    await recordFirstBodyBackground(page);
    const body = page.locator("body");
    const firstPaint = () => page.evaluate(() => sessionStorage.getItem("firstBodyBackground"));
    await page.goto("/login");

    // The system's dark mode, with each choice stored.
    await page.emulateMedia({ colorScheme: "dark" });
    const expected = { system: ground.dark, light: ground.light, dark: ground.dark };
    for (const choice of ["system", "light", "dark"] as const) {
      await page.evaluate((stored) => {
        if (stored === "system") localStorage.removeItem("smartman.theme");
        else localStorage.setItem("smartman.theme", stored);
      }, choice);
      await page.reload();

      expect({ choice, firstPaint: await firstPaint() }).toEqual({
        choice,
        firstPaint: expected[choice],
      });
      await expect(body).toHaveCSS("background-color", expected[choice]);
    }

    // Control: 다크 stays dark under the system's light mode, and 시스템 follows it.
    await page.emulateMedia({ colorScheme: "light" });
    await page.reload();
    expect(await firstPaint()).toBe(ground.dark);
    await page.evaluate(() => {
      localStorage.removeItem("smartman.theme");
    });
    await page.reload();
    expect(await firstPaint()).toBe(ground.light);
  });

  test("the icons and the manifest are served without a session", async ({ request }) => {
    for (const path of ["/favicon.svg", "/favicon-32.png", "/apple-touch-icon.png"]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect({ path, status: response.status() }).toEqual({ path, status: 200 });
    }
    const manifest = await request.get("/manifest.webmanifest", { maxRedirects: 0 });
    expect(manifest.status()).toBe(200);
    expect(await manifest.json()).toMatchObject({
      name: "알아몰라",
      short_name: "알아몰라",
      theme_color: "#EFFAF6",
    });
    for (const { src } of ((await manifest.json()) as { icons: { src: string }[] }).icons) {
      const icon = await request.get(src, { maxRedirects: 0 });
      expect({ src, status: icon.status() }).toEqual({ src, status: 200 });
    }
  });

  test("/api/health answers 200 without a session", async ({ request }) => {
    const response = await request.get("/api/health");

    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
