import { cleanup, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { verifyEmailCode } from "@/features/account/actions";
import { FakeAdmin } from "@/testing/mocks/admin";
import {
  otherAccessToken,
  otherUser,
  supabaseUrl,
  testAccessToken,
  testUser,
} from "@/testing/mocks/handlers";
import { server } from "@/testing/mocks/server";
import { setRequestCookies, setRequestHeaders } from "@/testing/next-headers";
import { redirectTarget } from "@/testing/redirect";
import { render } from "@/testing/render";

import { AdminGate } from "../_components/admin-gate";

vi.mock("next/headers", () => import("@/testing/next-headers"));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => "/",
}));

/** Auth's `verify` endpoint, answering a session for [user] whatever code it is given. */
function emailSession(user: typeof testUser | typeof otherUser) {
  server.use(
    http.post(`${supabaseUrl}/auth/v1/verify`, () =>
      HttpResponse.json({
        access_token: user === otherUser ? otherAccessToken : testAccessToken,
        refresh_token: "refresh-token",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: {
          id: user.id,
          email: user.email,
          aud: "authenticated",
          role: "authenticated",
          app_metadata: { provider: "email", providers: ["email"] },
        },
      }),
    ),
  );
}

/** Signs in by email code as [user], as the sign-in page does, setting the host's cookies. */
async function signInByEmail(user: typeof testUser | typeof otherUser) {
  setRequestCookies([{ name: "smartman-tz", value: "UTC" }]);
  emailSession(user);
  const form = new FormData();
  form.set("email", user.email);
  form.set("code", "123456");
  expect(await redirectTarget(verifyEmailCode({ message: null }, form))).toBe("/");
}

let admin: FakeAdmin;
beforeEach(() => {
  admin = new FakeAdmin();
  server.use(...admin.handlers);
  setRequestHeaders({ "x-knowno-service-origin": "https://knowno.app" });
});

describe("the admin area for an account that signed in by an email code", () => {
  it("admits the account only as an admin, and gives any other one line and nothing of the area", async () => {
    await signInByEmail(otherUser);
    await render(AdminGate, { children: <p>내용</p> });
    expect(screen.getByRole("heading", { name: "관리자만 들어올 수 있어요." })).toBeInTheDocument();
    expect(screen.queryByText("내용")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "관리 메뉴" })).not.toBeInTheDocument();

    // Control: the admin's email account is admitted, so it is the role that decides, not the way
    // it signed in.
    cleanup();
    await signInByEmail(testUser);
    await render(AdminGate, { children: <p>내용</p> });
    expect(screen.queryByRole("heading", { name: "관리자만 들어올 수 있어요." })).toBeNull();
    expect(screen.getByRole("navigation", { name: "관리 메뉴" })).toBeInTheDocument();
  });
});
