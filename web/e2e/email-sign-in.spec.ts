import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { untilReacted } from "./until-reacted";

/** The Mailpit catcher the web's stack starts, set through `E2E_MAIL_URL`. */
const mailUrl = process.env.E2E_MAIL_URL!;
test.skip(!mailUrl, "needs the web's stack, which starts Mailpit and sets E2E_MAIL_URL");

/** The newest message to [address] from Mailpit's API: subject, id, and to address. */
async function latestMessage(address: string) {
  const response = await fetch(
    `${mailUrl}/api/v1/messages?limit=1&to=${encodeURIComponent(address)}`,
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as Record<string, unknown>;
  const raw = body.messages ?? body.msgs ?? [];
  expect(Array.isArray(raw)).toBe(true);
  const messages = raw as unknown[];
  expect(messages.length).toBeGreaterThan(0);
  // Mailpit may return messages with either "Subject" or "subject".
  const first = messages[0] as Record<string, unknown>;
  return {
    subject:
      (typeof first.Subject === "string"
        ? first.Subject
        : typeof first.subject === "string"
          ? first.subject
          : null) ?? "",
  };
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

  // 3. Read the code from Mailpit. The subject is "알아몰라 로그인 코드 NNNNNN".
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

test("wrong code shown to the real one is also refused", async ({ page, baseURL }) => {
  if (!baseURL) throw new Error("skipped without local stack");

  const email = `web-email-signin-control-${randomUUID()}@example.com`;

  // Open the login page, send a code.
  await page.goto("/login");
  await untilReacted(
    () => page.getByRole("button", { name: "이메일로 계속하기" }).click(),
    () => Promise.resolve(page.getByRole("textbox", { name: "이메일" }).isVisible()),
  );
  await page.getByRole("textbox", { name: "이메일" }).fill(email);
  await untilReacted(
    () => page.getByRole("button", { name: "코드 받기" }).click(),
    () => Promise.resolve(page.getByRole("textbox", { name: "6자리 코드" }).isVisible()),
  );

  // Read the real code.
  const { subject } = await latestMessage(email);
  const realCode = extractCode(subject);

  // A wrong code that is not "000000" but differs from the real one.
  const wrongCode = realCode === "111111" ? "222222" : "111111";
  await page.getByRole("textbox", { name: "6자리 코드" }).fill(wrongCode);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(
    page.getByText("코드가 맞지 않거나 만료됐어요. 다시 확인하거나 새 코드를 받아 주세요"),
  ).toBeVisible();

  // Sign in with the real code.
  await page.getByRole("textbox", { name: "6자리 코드" }).fill(realCode);
  await untilReacted(
    () => page.getByRole("button", { name: "로그인", exact: true }).click(),
    () => Promise.resolve(page.url() === `${baseURL}/`),
  );
  await expect(page).toHaveURL(baseURL);
  await expect(page.getByRole("heading", { name: "첫 노트를 만들어 볼까요?" })).toBeVisible();
});
