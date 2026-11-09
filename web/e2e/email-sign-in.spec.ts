import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { untilReacted } from "./until-reacted";

/** The Mailpit catcher the web's stack starts, set through `E2E_MAIL_URL`. */
const mailUrl = process.env.E2E_MAIL_URL;

test.skip(
  !mailUrl,
  "needs the local stack scripts/test-web.ts starts with Mailpit, which sets E2E_MAIL_URL",
);

/** True for a non-null, non-array object, so its keys can be read as `unknown`. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The 6-digit code in the Subject of the newest message in a Mailpit search response, or `null`
 * when the response has no message, the Subject is not a string, or it carries no code. The
 * shape is Mailpit v1.31.3's `MessagesSummary` (`messages`, each a `MessageSummary` with
 * `Subject`; `server/apiv1/messages.go` and `internal/storage/structs.go` at that tag). The
 * newest comes first: `/api/v1/search` sorts by received date, descending.
 */
function codeInSearch(body: unknown): string | null {
  if (!isRecord(body) || !Array.isArray(body.messages)) return null;
  const newest: unknown = body.messages[0];
  if (!isRecord(newest) || typeof newest.Subject !== "string") return null;
  const match = /코드\s+(\d{6})/.exec(newest.Subject);
  const code = match?.[1];
  return code === undefined ? null : code;
}

/**
 * Polls Mailpit's search endpoint, `GET /api/v1/search?query=to:"<address>"` (Mailpit's search
 * filters), until a message for [address] carries a code, and returns that code. The value the
 * poll accepts is the value returned.
 */
async function codeSentTo(address: string): Promise<string> {
  if (!mailUrl) throw new Error("skipped above");
  const query = `to:"${address}"`;
  const found: { code: string | null } = { code: null };
  await expect(async () => {
    const response = await fetch(`${mailUrl}/api/v1/search?query=${encodeURIComponent(query)}`);
    expect(response.status).toBe(200);
    found.code = codeInSearch(await response.json());
    expect(found.code, `no message for ${address} carries a 6-digit code yet`).not.toBeNull();
  }).toPass({ timeout: 10_000 });
  if (found.code === null) throw new Error(`no code for ${address}`);
  return found.code;
}

/** A 6-digit code that is not [code]: its last digit moved by one. */
function otherCode(code: string): string {
  return `${code.slice(0, 5)}${String((Number(code.slice(5)) + 1) % 10)}`;
}

test("sends a code to a fresh address, reads it from Mailpit, wrong code is refused, right code signs in", async ({
  page,
  baseURL,
}) => {
  if (!baseURL) throw new Error("baseURL is unset: playwright.config.ts sets it from E2E_BASE_URL");

  // A fresh address: the first code send creates the account.
  const email = `web-email-signin-${randomUUID()}@example.com`;

  // 1. Open the login page and press "이메일로 계속하기".
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "알아몰라", exact: true })).toBeVisible();

  await untilReacted(
    () => page.getByRole("button", { name: "이메일로 계속하기" }).click(),
    () => Promise.resolve(page.getByRole("textbox", { name: "이메일" }).isVisible()),
  );

  // 2. Enter the email and send the code.
  await page.getByRole("textbox", { name: "이메일" }).fill(email);
  await untilReacted(
    () => page.getByRole("button", { name: "코드 받기" }).click(),
    () => Promise.resolve(page.getByRole("textbox", { name: "6자리 코드" }).isVisible()),
  );

  // 3. Poll Mailpit until the code arrives.
  const code = await codeSentTo(email);

  // 4. Try a wrong code (the real one with its last digit moved): the refusal sentence appears.
  await page.getByRole("textbox", { name: "6자리 코드" }).fill(otherCode(code));
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(
    page.getByText("코드가 맞지 않거나 만료됐어요. 다시 확인하거나 새 코드를 받아 주세요"),
  ).toBeVisible();

  // 5. Enter the real code and sign in: the page redirects to / and the user is in.
  await page.getByRole("textbox", { name: "6자리 코드" }).fill(code);
  await untilReacted(
    () => page.getByRole("button", { name: "로그인", exact: true }).click(),
    () => Promise.resolve(page.url() === `${baseURL}/`),
  );

  // Signed in: 홈 is visible, with a tab bar and account navigation.
  await expect(page).toHaveURL(baseURL);
  await expect(page.getByRole("heading", { name: "첫 노트를 만들어 볼까요?" })).toBeVisible();
});
