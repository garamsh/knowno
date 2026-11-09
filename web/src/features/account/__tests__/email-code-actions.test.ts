import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  supabaseUnreachable,
  supabaseUrl,
  testAccessToken,
  testUser,
} from "@/testing/mocks/handlers";
import { server } from "@/testing/mocks/server";
import { currentCookies, setRequestCookies } from "@/testing/next-headers";
import { redirectTarget } from "@/testing/redirect";

import { emailMessages, rateLimited } from "../email-sign-in";
import { sendEmailCode } from "../send-email-code";
import { verifyEmailCode } from "../verify-email-code";

vi.mock("next/headers", () => import("@/testing/next-headers"));

/** The requests the fake Auth took, by endpoint and body. */
let taken: { path: string; body: Record<string, unknown> }[];

/** Auth's `otp` endpoint answering [answer], and its `verify` endpoint taking [good] as the code. */
function auth(answer: { status: number; body: Record<string, unknown> } | "ok", good = "123456") {
  server.use(
    http.post(`${supabaseUrl}/auth/v1/otp`, async ({ request }) => {
      taken.push({ path: "otp", body: (await request.json()) as Record<string, unknown> });
      return answer === "ok"
        ? HttpResponse.json({})
        : HttpResponse.json(answer.body, { status: answer.status });
    }),
    http.post(`${supabaseUrl}/auth/v1/verify`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      taken.push({ path: "verify", body });
      if (body.token !== good) {
        return HttpResponse.json(
          { code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" },
          { status: 403 },
        );
      }
      return HttpResponse.json({
        access_token: testAccessToken,
        refresh_token: "refresh-token",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: {
          id: testUser.id,
          email: testUser.email,
          aud: "authenticated",
          role: "authenticated",
        },
      });
    }),
  );
}

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};
/**
 * The cookies that hold a session: Auth's PKCE code verifier, which a send writes and which may
 * land after its test, is not one.
 */
const sessionCookies = () =>
  currentCookies().filter((cookie) => !cookie.name.endsWith("-code-verifier"));
const first = { sent: 0, email: null, resendIn: null, message: null };

beforeEach(() => {
  taken = [];
  setRequestCookies([]);
});

describe("sendEmailCode", () => {
  it("asks Auth to send a code to the parsed address, creating the account on first use, and says when to resend", async () => {
    auth("ok");

    expect(await sendEmailCode(first, form({ email: " Kim@Example.com " }))).toEqual({
      sent: 1,
      email: "kim@example.com",
      resendIn: 60,
      message: null,
    });

    expect(taken).toHaveLength(1);
    expect(taken[0]?.body).toMatchObject({ email: "kim@example.com", create_user: true });
  });

  it("counts a resend to the same address as another send", async () => {
    auth("ok");
    const once = await sendEmailCode(first, form({ email: "kim@example.com" }));
    expect((await sendEmailCode(once, form({ email: "kim@example.com" }))).sent).toBe(2);
  });

  it("refuses an address of no shape before asking Auth", async () => {
    auth("ok");
    for (const email of ["", "kim", "kim@example"]) {
      expect(await sendEmailCode(first, form({ email }))).toEqual({
        ...first,
        message: emailMessages.address,
      });
    }
    expect(await sendEmailCode(first, new FormData())).toMatchObject({
      message: emailMessages.address,
    });
    expect(taken).toEqual([]);
    // Control: the same action with an address Auth is asked.
    await sendEmailCode(first, form({ email: "kim@example.com" }));
    expect(taken).toHaveLength(1);
  });

  it("says each way Auth refuses a send, and for a rate limit when the next is allowed", async () => {
    const send = () => sendEmailCode(first, form({ email: "kim@example.com" }));
    auth({
      status: 429,
      body: {
        code: 429,
        error_code: "over_email_send_rate_limit",
        msg: "For security purposes, you can only request this after 30 seconds.",
      },
    });
    expect(await send()).toMatchObject({ message: rateLimited(30), resendIn: 30, sent: 0 });
    auth({ status: 400, body: { code: 400, error_code: "email_address_invalid", msg: "invalid" } });
    expect(await send()).toMatchObject({ message: emailMessages.refused });
    auth({ status: 500, body: { code: 500, error_code: "unexpected_failure", msg: "boom" } });
    expect(await send()).toMatchObject({ message: emailMessages.unavailable });
    server.use(supabaseUnreachable);
    expect(await send()).toMatchObject({ message: emailMessages.offline });
  });
});

describe("verifyEmailCode", () => {
  it("signs in with the 6 digits, sets the session as cookies and opens /", async () => {
    auth("ok");

    expect(
      await redirectTarget(
        verifyEmailCode({ message: null }, form({ email: "Kim@Example.com", code: "123 456" })),
      ),
    ).toBe("/");

    expect(taken.at(-1)?.path).toBe("verify");
    expect(taken.at(-1)?.body).toMatchObject({
      email: "kim@example.com",
      token: "123456",
      type: "email",
    });
    expect(sessionCookies().length).toBeGreaterThan(0);
  });

  it("returns the one sentence for a wrong or expired code, and sets no cookie", async () => {
    auth("ok");

    expect(
      await verifyEmailCode({ message: null }, form({ email: "kim@example.com", code: "000000" })),
    ).toEqual({ message: emailMessages.wrongOrExpired });
    expect(sessionCookies()).toEqual([]);
  });

  it("refuses a code that is not 6 digits and an address of no shape before asking Auth", async () => {
    auth("ok");
    expect(
      await verifyEmailCode({ message: null }, form({ email: "kim@example.com", code: "12345" })),
    ).toEqual({
      message: emailMessages.code,
    });
    expect(
      await verifyEmailCode({ message: null }, form({ email: "kim", code: "123456" })),
    ).toEqual({
      message: emailMessages.address,
    });
    expect(taken).toEqual([]);
  });

  it("says offline when Auth cannot be reached, and signs in when it can", async () => {
    server.use(supabaseUnreachable);
    expect(
      await verifyEmailCode({ message: null }, form({ email: "kim@example.com", code: "123456" })),
    ).toEqual({ message: emailMessages.offline });
    auth("ok");
    expect(
      await redirectTarget(
        verifyEmailCode({ message: null }, form({ email: "kim@example.com", code: "123456" })),
      ),
    ).toBe("/");
  });
});
