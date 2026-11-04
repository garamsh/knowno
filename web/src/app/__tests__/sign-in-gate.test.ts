// @vitest-environment node
import { readdirSync } from "node:fs";
import path from "node:path";

import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";

import { config, proxy } from "@/proxy";
import { supabaseUnreachable } from "@/testing/mocks/handlers";
import { server } from "@/testing/mocks/server";
import { signedInCookies } from "@/testing/session";

const publicRoutes = ["/login", "/auth/callback", "/terms", "/privacy", "/api/health"];

/** Every URL the app routes: one per page.tsx or route.ts under src/app. */
function appRoutes(): string[] {
  const appDir = path.join(import.meta.dirname, "..");
  return readdirSync(appDir, { recursive: true, encoding: "utf8" })
    .map((file) => file.split(path.sep))
    .filter((parts) => /^(page\.tsx|route\.ts)$/.test(parts.at(-1) ?? ""))
    .filter((parts) => !parts.some((part) => part.startsWith("_")))
    .map(
      (parts) =>
        "/" +
        parts
          .slice(0, -1)
          .filter((part) => !/^\(.*\)$/.test(part))
          .join("/"),
    );
}

type Cookie = { name: string; value: string };

/** The service's origin in these tests, and its admin host's. */
const service = "http://localhost:3000";
const adminHost = "http://admin.localhost:3000";

/** What a request for [pathname] meets: whether the proxy runs, and where it redirects. */
async function visit(pathname: string, cookies: Cookie[] = [], origin = service) {
  const { matched, response } = await respond(pathname, cookies, origin);
  return { matched, location: response?.headers.get("location") ?? null };
}

/**
 * The proxy's whole response to a request for [pathname] on [origin], or null where it does not
 * run, with any other [headers] the client sent. As `next start` and the standalone server hand
 * it over, the request's URL names the server's own address, and only the Host header names the
 * host the visitor asked for.
 */
async function respond(
  pathname: string,
  cookies: Cookie[] = [],
  origin = service,
  headers: Record<string, string> = {},
) {
  const url = `${origin}${pathname}`;
  const matched = unstable_doesMiddlewareMatch({
    config,
    url,
    cookies: Object.fromEntries(cookies.map(({ name, value }) => [name, value])),
  });
  if (!matched) return { matched, response: null };
  const request = new NextRequest(`${served}${pathname}`, {
    headers: {
      host: new URL(origin).host,
      cookie: cookies.map(({ name, value }) => `${name}=${value}`).join("; "),
      ...headers,
    },
  });
  return { matched, response: await proxy(request) };
}

/** The address the server listens on, which `next start` puts in every request's URL. */
const served = "http://127.0.0.1:3000";

/** The cookie the proxy keeps an AI app's consent in across sign-in. */
const consentCookie = "smartman-oauth-consent";

const routes = appRoutes();
/** The admin area's routes, which the service's host does not serve (ADR 0178). */
const isAdminRoute = (route: string) => route === "/admin" || route.startsWith("/admin/");
const adminRoutes = routes.filter(isAdminRoute);
const gatedRoutes = [
  ...routes.filter((route) => !publicRoutes.includes(route) && !isAdminRoute(route)),
  "/no-such-page",
];
/** Each admin route by its path on the admin host: `/admin/users` is `/users` there. */
const adminPaths = adminRoutes.map((route) => route.slice("/admin".length) || "/");

describe("the sign-in gate", () => {
  let signedIn: Cookie[];
  beforeAll(async () => {
    signedIn = await signedInCookies();
  });

  it("finds every route the app serves", () => {
    expect(routes).toEqual(expect.arrayContaining(["/", ...publicRoutes]));
    expect(adminRoutes).toEqual(expect.arrayContaining(["/admin", "/admin/login", "/admin/users"]));
  });

  it("sends a signed-out visitor from every other route to /login", async () => {
    for (const route of gatedRoutes) {
      expect(await visit(route), route).toEqual({
        matched: true,
        location: "http://localhost:3000/login",
      });
    }
  });

  it("lets a signed-out visitor open /login, /auth/callback, the legal pages and /api/health", async () => {
    for (const route of publicRoutes) {
      expect((await visit(route)).location, route).toBeNull();
    }
  });

  it("lets a signed-in visitor open every route", async () => {
    for (const route of gatedRoutes) {
      expect((await visit(route, signedIn)).location, route).toBeNull();
    }
  });

  it("sends a visitor whose session Supabase rejects to /login", async () => {
    const rejected = signedIn.map(({ name }) => ({ name, value: "base64-e30" }));
    expect((await visit("/", rejected)).location).toBe("http://localhost:3000/login");
  });

  it("keeps a signed-in visitor on the page while Supabase is unreachable", async () => {
    server.use(supabaseUnreachable);
    expect((await visit("/", signedIn)).location).toBeNull();
  });

  it("keeps the consent a signed-out visitor was sent from to /login, and opens it once sign-in lands on /", async () => {
    const { response: out } = await respond("/oauth/consent?authorization_id=abc_123-XYZ");
    expect(out?.headers.get("location")).toBe("http://localhost:3000/login");
    expect(out?.cookies.get(consentCookie)).toMatchObject({
      value: "abc_123-XYZ",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 600,
    });

    const { response: back } = await respond("/", [
      ...signedIn,
      { name: consentCookie, value: "abc_123-XYZ" },
    ]);
    expect(back?.headers.get("location")).toBe(
      "http://localhost:3000/oauth/consent?authorization_id=abc_123-XYZ",
    );
    expect(back?.cookies.get(consentCookie)?.value).toBe("");
    // Control: without the cookie, a signed-in visitor stays on /.
    expect((await visit("/", signedIn)).location).toBeNull();
  });

  it("keeps no consent for a malformed id, and drops a malformed cookie without leaving /", async () => {
    const { response: out } = await respond("/oauth/consent?authorization_id=..%2Fadmin");
    expect(out?.headers.get("location")).toBe("http://localhost:3000/login");
    expect(out?.cookies.get(consentCookie)).toBeUndefined();

    const { response: back } = await respond("/", [
      ...signedIn,
      { name: consentCookie, value: "../admin" },
    ]);
    expect(back?.headers.get("location")).toBeNull();
    expect(back?.cookies.get(consentCookie)?.value).toBe("");
  });

  it("opens a kept consent from / alone, not from another page", async () => {
    const { response } = await respond("/decks", [
      ...signedIn,
      { name: consentCookie, value: "abc_123-XYZ" },
    ]);
    expect(response?.headers.get("location")).toBeNull();
  });
});

describe("the admin host", () => {
  let signedIn: Cookie[];
  beforeAll(async () => {
    signedIn = await signedInCookies();
  });

  it("moves every admin route of the service's host, signed in or out, permanently to the same path there", async () => {
    for (const cookies of [[], signedIn]) {
      for (const route of [...adminRoutes, "/admin/users?q=kim&page=2"]) {
        const { response } = await respond(route, cookies);
        expect(response?.status, route).toBe(308);
        expect(response?.headers.get("location"), route).toBe(
          `${adminHost}${route.slice("/admin".length).replace(/^(\?|$)/, "/$1")}`,
        );
      }
    }
    // Control: a path that only starts with the same letters stays on the service's host.
    expect((await visit("/administer", signedIn)).location).toBeNull();
  });

  it("sends a signed-out visitor from every path but its sign-in and the code exchange to its own /login", async () => {
    // The redirect names the server's own address, the request URL's origin, which Next.js sends
    // as the relative `/login`, so the browser stays on the admin host it asked for.
    const own = new NextRequest(served).nextUrl.origin;
    for (const path of [...adminPaths.filter((path) => path !== "/login"), "/record", "/terms"]) {
      expect(await visit(path, [], adminHost), path).toEqual({
        matched: true,
        location: `${own}/login`,
      });
    }
    // Control: its sign-in and the code exchange open signed out.
    expect((await visit("/login", [], adminHost)).location).toBeNull();
    expect((await visit("/auth/callback", [], adminHost)).location).toBeNull();
  });

  it("serves every path from the admin area, so none of the service's pages opens there", async () => {
    const target = async (path: string) => {
      const { response } = await respond(path, signedIn, adminHost);
      expect(response?.headers.get("location"), path).toBeNull();
      const rewrite = response?.headers.get("x-middleware-rewrite");
      return rewrite ? new URL(rewrite).pathname : null;
    };
    for (const path of adminPaths) {
      expect(await target(path), path).toBe(path === "/" ? "/admin" : `/admin${path}`);
    }
    // Every page of the service the area has no page for is looked for in the area, and not found.
    const servicePages = routes.filter(
      (route) =>
        !isAdminRoute(route) &&
        !route.startsWith("/api/") &&
        route !== "/auth/callback" &&
        !routes.includes(route === "/" ? "/admin" : `/admin${route}`),
    );
    expect(servicePages).toEqual(
      expect.arrayContaining(["/record", "/account", "/study", "/terms", "/oauth/consent"]),
    );
    for (const route of servicePages) {
      expect(await target(route), route).toBe(`/admin${route}`);
    }
    // Control: the code exchange is the service's own route, not the area's.
    expect(await target("/auth/callback")).toBeNull();
  });

  it("takes the forwarded host where the Host header names none of the deployment's, so a Server Action's redirect, fetched on the server's own address, stays on the admin host", async () => {
    // The fetch Next.js makes to render an action's redirect: its Host is the server's address,
    // and the action's X-Forwarded-Host rides along.
    const internal = (headers: Record<string, string>) =>
      proxy(
        new NextRequest(`${served}/login`, {
          headers: { host: new URL(served).host, ...headers },
        }),
      );
    const forwarded = await internal({ "x-forwarded-host": new URL(adminHost).host });
    expect(new URL(forwarded.headers.get("x-middleware-rewrite") ?? "", served).pathname).toBe(
      "/admin/login",
    );
    // Control: without it the same fetch is the service's own `/login`.
    const plain = await internal({});
    expect(plain.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("serves no admin page on the service's host to a client that names the admin host in X-Forwarded-Host", async () => {
    const spoofed = await respond("/users", signedIn, service, {
      "x-forwarded-host": new URL(adminHost).host,
    });
    expect(spoofed.response?.status).toBe(421);
    expect(spoofed.response?.headers.get("x-middleware-rewrite")).toBeNull();
    // Control: the same request on the admin host is served from the area.
    const { response } = await respond("/users", signedIn, adminHost, {
      "x-forwarded-host": new URL(adminHost).host,
    });
    expect(new URL(response?.headers.get("x-middleware-rewrite") ?? "", served).pathname).toBe(
      "/admin/users",
    );
  });

  it("serves a host the deployment does not name as the service, and moves its /admin to the configured admin host", async () => {
    const unnamed = "http://admin.evil.example";
    const { response } = await respond("/users", signedIn, unnamed);
    expect(response?.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response?.headers.get("location")).toBeNull();
    for (const origin of [unnamed, "http://evil.example", "http://127.0.0.1:3000"]) {
      const { response: moved } = await respond("/admin/users?q=kim", signedIn, origin);
      expect(moved?.status, origin).toBe(308);
      expect(moved?.headers.get("location"), origin).toBe(`${adminHost}/users?q=kim`);
    }
    // Control: the configured admin host's same path is served from the area.
    const { response: named } = await respond("/users", signedIn, adminHost);
    expect(new URL(named?.headers.get("x-middleware-rewrite") ?? "", served).pathname).toBe(
      "/admin/users",
    );
  });

  it("replaces a service origin the client sent with the configured one, and drops it on the service's host", async () => {
    const sent = { "x-knowno-service-origin": "https://evil.example", "x-other": "kept" };
    const { response: admin } = await respond("/users", signedIn, adminHost, sent);
    expect(admin?.headers.get("x-middleware-request-x-knowno-service-origin")).toBe(service);
    const { response: home } = await respond("/", signedIn, service, sent);
    expect(home?.headers.get("x-middleware-request-x-knowno-service-origin")).toBeNull();
    expect(home?.headers.get("x-middleware-override-headers")?.split(",")).not.toContain(
      "x-knowno-service-origin",
    );
    // Control: the client's other headers still reach the page, so the override is in force.
    expect(home?.headers.get("x-middleware-request-x-other")).toBe("kept");
  });

  it("runs on every admin path of the service's host and every path of the admin host, whatever its extension", async () => {
    for (const route of ["/admin/x.png", "/admin/decks/a.svg", "/admin/a.webmanifest"]) {
      const { matched, response } = await respond(route, signedIn);
      expect(matched, route).toBe(true);
      expect(response?.status, route).toBe(308);
      expect(response?.headers.get("location"), route).toBe(
        `${adminHost}${route.slice("/admin".length)}`,
      );
    }
    const { response } = await respond("/decks/a.svg", signedIn, adminHost);
    expect(new URL(response?.headers.get("x-middleware-rewrite") ?? "", served).pathname).toBe(
      "/admin/decks/a.svg",
    );
    // Control: the files of public/ are still served without it.
    for (const file of [
      "/icon-192.png",
      "/favicon.svg",
      "/brand/knowno-happy.svg",
      "/google/g-mark-dark.png",
      "/manifest.webmanifest",
    ]) {
      expect((await respond(file)).matched, file).toBe(false);
    }
  });

  it("hands every admin page the service's origin, which 서비스 열기 opens", async () => {
    const { response } = await respond("/users", signedIn, adminHost);
    expect(response?.headers.get("x-middleware-request-x-knowno-service-origin")).toBe(service);
    // Control: the service's own pages are not given it.
    const { response: home } = await respond("/", signedIn);
    expect(home?.headers.get("x-middleware-request-x-knowno-service-origin")).toBeNull();
  });
});
