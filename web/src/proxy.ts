import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/env";
import { readSession } from "@/supabase/session";

/** The paths a signed-out visitor may open on the service's host; `/api` is outside the matcher. */
const publicPaths = new Set(["/login", "/auth/callback", "/terms", "/privacy"]);

/** The paths a signed-out visitor may open on the admin host: its sign-in and the code exchange. */
const adminPublicPaths = new Set(["/login", "/auth/callback"]);

/** How the admin host's name starts: `admin.knowno.app`, and `admin.localhost` on a machine. */
const adminLabel = "admin.";

/** Where the admin area's routes live under `src/app/`, which the admin host's paths are rewritten into. */
const adminRoot = "/admin";

/**
 * The request header every admin page is given: the origin of the service whose admin host it is,
 * which the admin menu's "서비스 열기" opens.
 */
export const serviceOriginHeader = "x-knowno-service-origin";

/**
 * Serves the admin area on its own host and the service on every other (ADR 0178). The service's
 * `/admin` and every path below it move permanently to the same path on the admin host, and every
 * path of the admin host but the code exchange is rewritten into the admin area, so no page of the
 * service opens there. On both hosts it refreshes the Supabase session, whose cookies stay on the
 * host that set them, and sends a signed-out visitor to that host's `/login`; on the service's it
 * keeps an AI app's consent to return to after sign-in (ADR 0126). Server Actions re-verify the
 * session themselves (stack-nextjs §5).
 */
export async function proxy(request: NextRequest) {
  const { pathname, searchParams, search, protocol } = request.nextUrl;
  const host = requestedHost(request);
  const onAdminHost = host.startsWith(adminLabel);
  if (!onAdminHost && (pathname === adminRoot || pathname.startsWith(`${adminRoot}/`))) {
    const path = pathname.slice(adminRoot.length) || "/";
    return NextResponse.redirect(`${protocol}//${adminLabel}${host}${path}${search}`, 308);
  }

  let response = NextResponse.next({ request });
  // What Supabase asks of the response besides the cookies: that no cache keeps it.
  let sessionHeaders: Record<string, string> = {};
  const supabase = createServerClient(env.supabaseUrl, env.supabasePublishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        sessionHeaders = headers;
        for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
      },
    },
  });

  const session = await readSession(supabase);
  if (onAdminHost) {
    if (session.kind === "signed-out" && !adminPublicPaths.has(pathname)) {
      return toLogin(request, response);
    }
    if (pathname === "/auth/callback") return response;
    return intoAdminArea(
      request,
      response,
      sessionHeaders,
      `${protocol}//${host.slice(adminLabel.length)}`,
    );
  }

  if (session.kind === "signed-out" && !publicPaths.has(pathname)) {
    const redirect = toLogin(request, response);
    const authorization = searchParams.get("authorization_id");
    if (pathname === "/oauth/consent" && authorization && AUTHORIZATION_ID.test(authorization)) {
      redirect.cookies.set(consentCookie, authorization, {
        httpOnly: true,
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:",
        path: "/",
        maxAge: consentCookieSeconds,
      });
    }
    return redirect;
  }
  // Sign-in always opens `/`: an AI app's consent the visitor left to sign in opens instead, once.
  const pending = request.cookies.get(consentCookie)?.value;
  if (session.kind === "signed-in" && pathname === "/" && pending !== undefined) {
    if (!AUTHORIZATION_ID.test(pending)) {
      response.cookies.delete(consentCookie);
      return response;
    }
    const consent = request.nextUrl.clone();
    consent.pathname = "/oauth/consent";
    consent.search = `?authorization_id=${pending}`;
    const redirect = NextResponse.redirect(consent);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    redirect.cookies.delete(consentCookie);
    return redirect;
  }
  return response;
}

/**
 * The host the visitor asked for, as its Host header names it. Behind `next start` and the
 * standalone server the request's URL names the server's own address instead (Next.js 16.4.1,
 * `server/lib/router-utils/resolve-routes.js`), so the URL cannot tell the two hosts apart.
 */
function requestedHost(request: NextRequest): string {
  return request.headers.get("host") ?? request.nextUrl.host;
}

/**
 * The admin host's [request] rewritten into the admin area: `/users` serves `/admin/users`, with
 * the session [response] refreshed and its [headers], and the [service]'s origin for the menu.
 */
function intoAdminArea(
  request: NextRequest,
  response: NextResponse,
  headers: Record<string, string>,
  service: string,
) {
  const forwarded = new Headers(request.headers);
  forwarded.set(serviceOriginHeader, service);

  const destination = request.nextUrl.clone();
  destination.pathname = `${adminRoot}${destination.pathname === "/" ? "" : destination.pathname}`;
  const rewrite = NextResponse.rewrite(destination, { request: { headers: forwarded } });
  for (const cookie of response.cookies.getAll()) rewrite.cookies.set(cookie);
  for (const [name, value] of Object.entries(headers)) rewrite.headers.set(name, value);
  return rewrite;
}

/** A redirect to this host's `/login`, carrying the session cookies [response] cleared or refreshed. */
function toLogin(request: NextRequest, response: NextResponse) {
  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  const redirect = NextResponse.redirect(login);
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

/** The cookie holding the id of the consent a signed-out visitor was sent from to `/login`. */
const consentCookie = "smartman-oauth-consent";
/** As long as Supabase Auth keeps an authorization open: ten minutes. */
const consentCookieSeconds = 600;
/** The form of Supabase Auth's authorization ids, the only value the cookie may carry. */
const AUTHORIZATION_ID = /^[A-Za-z0-9_-]{1,128}$/;

export const config = {
  // The files under public/, the icons, the manifest and brand/, are served to everyone.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|brand/|.*\\.(?:svg|png|webmanifest)$).*)",
  ],
};
