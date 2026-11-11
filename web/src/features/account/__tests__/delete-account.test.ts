// @vitest-environment node
// The action runs on the server, where Supabase Auth has no browser: under jsdom each client it
// makes listens on a BroadcastChannel, and a sign-out elsewhere, this file's own included, reaches
// the clients earlier calls left and clears the cookies of a later test.
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabaseUrl, testAccessToken } from "@/testing/mocks/handlers";
import { server } from "@/testing/mocks/server";
import { currentCookies, setRequestCookies } from "@/testing/next-headers";
import { redirectTarget } from "@/testing/redirect";
import { signedInCookies } from "@/testing/session";

import { deleteAccount } from "../actions";

vi.mock("next/headers", () => import("@/testing/next-headers"));

const rejected = { error: "계정을 삭제하지 못했어요. 다시 시도해 주세요." };
const unreachable = { error: "계정을 삭제하지 못했어요. 연결을 확인하고 다시 시도해 주세요." };

type Call = { method: string; authorization: string | null; body: string };

/** The `delete-account` function answering [status], recording each request it gets. */
function functionAnswering(status: number, calls: Call[]) {
  return http.all(`${supabaseUrl}/functions/v1/delete-account`, async ({ request }) => {
    calls.push({
      method: request.method,
      authorization: request.headers.get("authorization"),
      body: await request.text(),
    });
    return status === 204
      ? new HttpResponse(null, { status })
      : HttpResponse.json({ error: "x" }, { status });
  });
}

describe("deleteAccount", () => {
  beforeEach(async () => {
    setRequestCookies(await signedInCookies());
  });

  it("posts to the function with the session's token and no body, ends this browser's session and opens /login saying so", async () => {
    const calls: Call[] = [];
    const scopes: (string | null)[] = [];
    server.use(
      functionAnswering(204, calls),
      http.post(`${supabaseUrl}/auth/v1/logout`, ({ request }) => {
        scopes.push(new URL(request.url).searchParams.get("scope"));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    expect(currentCookies()).not.toEqual([]);

    expect(await redirectTarget(deleteAccount())).toBe("/login?deleted=1");

    expect(calls).toEqual([
      { method: "POST", authorization: `Bearer ${testAccessToken}`, body: "" },
    ]);
    expect(scopes).toEqual(["local"]);
    expect(currentCookies()).toEqual([]);
  });

  it("keeps the session and says so when the function refuses, and deletes when retried", async () => {
    const calls: Call[] = [];
    server.use(functionAnswering(502, calls));

    expect(await deleteAccount()).toEqual(unreachable);
    server.use(functionAnswering(401, calls));
    expect(await deleteAccount()).toEqual(rejected);
    // Control: both reached the function, and neither signed anyone out.
    expect(calls).toHaveLength(2);
    expect(currentCookies()).not.toEqual([]);

    server.use(functionAnswering(204, calls));
    expect(await redirectTarget(deleteAccount())).toBe("/login?deleted=1");
    expect(currentCookies()).toEqual([]);
  });

  it("keeps the session and says so when the function cannot be reached", async () => {
    server.use(http.all(`${supabaseUrl}/functions/v1/delete-account`, () => HttpResponse.error()));

    expect(await deleteAccount()).toEqual(unreachable);
    expect(currentCookies()).not.toEqual([]);
  });
});
