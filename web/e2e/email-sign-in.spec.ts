import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { untilReacted } from "./until-reacted";

/** The Mailpit catcher the web's stack starts, set through `E2E_MAIL_URL`. */
const rawUrl = process.env.E2E_MAIL_URL;
if (!rawUrl) throw new Error("E2E_MAIL_URL is unset — the web's stack starts Mailpit and sets it");
const mailUrl: string = rawUrl;

/**
 * Polls Mailpit's search endpoint until a message for [address] arrives, then returns its
 * Subject and id. Reads the documented API for Mailpit v1.19+: GET /api/v1/search with
 * query `to:"<address>"` (search-filters.md, axllent/mailpit). The response shape is
 * validated: MessagesSummary → MessagesMessage[] → Subject (capitalised) and Id.
 * runtime-safety.md §Trust boundaries — the JSON is the trust boundary it is, not casts.
 */
async function latestMessage(address: string) {
  const query = `to:"${address}"`;
  // Poll until a message for this address exists (the condition we depend on).
  await expect
    .poll(
      async () => {
        const response = await fetch(`${mailUrl}/api/v1/search?query=${encodeURIComponent(query)}`);
        expect(response.status).toBe(200);
        const body = (await response.json()) as Record<string, unknown>;
        const raw = body.messages as Array<unknown>;
        return raw.length > 0;
      },
      { timeout: 10_000, message: "Mailpit has a message for this address" },
    )
    .toBe(true);

  // The message is there — read it and validate the shape.
  const response = await fetch(`${mailUrl}/api/v1/search?query=${encodeURIComponent(query)}`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as Record<string, unknown>;
  const msgs = body.messages as Array<Record<string, unknown>>;
  expect(msgs.length).toBeGreaterThan(0);
  const first: Record<string, unknown> = msgs[0]!;
  expect(typeof first.Subject).toBe("string");
  expect(typeof first.Id).toBe("string");

  return { subject: first.Subject as string, id: first.Id as string };
}

/**
 * Extracts the 6-digit code from a subject like "알아몰라 로그인 코드 NNNNNN", or fails.
 */
function extractCode(subject: string): string {
  const match = subject.match(/코드\s+(\d{6})/);
  expect(match, `subject does not carry a 6-digit code: ${subject}`).not.toBeNull();
  return match![1]!;
}

test("sends a code to a fresh address, reads it from Mailpit, wrong code is refused, right code signs in", async ({
  page,
  baseURL,
}) => {
  if (!baseURL) throw new Error("skipped without local stack");

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

  // 3. Poll Mailpit until the code arrives, then extract it.
  const { subject } = await latestMessage(email);
  const code = extractCode(subject);

  // 4. Try a wrong code ("000000"): the refusal sentence appears.
  await page.getByRole("textbox", { name: "6자리 코드" }).fill("000000");
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
