import { readFileSync } from "node:fs";
import path from "node:path";

import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { render } from "@/testing/render";

import LoginPage from "../page";

vi.mock("@/supabase/browser", () => ({
  createClient: () => ({ auth: { signInWithOAuth: vi.fn() } }),
}));

// Apple's script, which draws its button, is not loaded here; the wrapper it draws into is.
vi.mock("next/script", () => ({ default: () => null }));

const globalsCss = readFileSync(
  path.join(import.meta.dirname, "../../../styles/globals.css"),
  "utf8",
);

describe("the login page", () => {
  it("shows the stacked logo, the welcome sentence, Google's and Apple's buttons and the consent line with its links", async () => {
    await render(LoginPage, { params: Promise.resolve({}), searchParams: Promise.resolve({}) });

    // Both themes' logos are in the tree and CSS, which hides one, does not run here, so the name
    // is matched as a substring; e2e/sign-in.spec.ts asserts the whole name in a browser.
    const heading = screen.getByRole("heading", { level: 1, name: /알아몰라/ });
    expect(Array.from(heading.querySelectorAll("img"), (img) => img.getAttribute("src"))).toEqual([
      "/brand/knowno-stacked-light.svg",
      "/brand/knowno-stacked-dark.svg",
    ]);
    // The phone's welcomeBody, its line break kept.
    expect(screen.getByText(/^밀어서 응답하고,/).textContent).toBe(
      "밀어서 응답하고,\n잊을 때쯤 다시 만나는 암기 카드",
    );
    expect(screen.getByRole("button", { name: "Google로 계속하기" })).toBeEnabled();
    // The third way, after Google's and Apple's: a button until pressed.
    const email = screen.getByRole("button", { name: "이메일로 계속하기" });
    expect(email).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Google로 계속하기" }).compareDocumentPosition(email) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(document.getElementById("appleid-signin")).toHaveAttribute("data-type", "continue");
    expect(
      screen.getByText("계속하면 이용약관과 개인정보 처리방침에 동의하는 것으로 봐요."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "이용약관" })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: "개인정보 처리방침" })).toHaveAttribute(
      "href",
      "/privacy",
    );
  });

  it("draws Google's, Apple's and the email button as one group: 48 high, one width, in that order", async () => {
    await render(LoginPage, { params: Promise.resolve({}), searchParams: Promise.resolve({}) });

    const google = screen.getByRole("button", { name: "Google로 계속하기" });
    const apple = document.getElementById("appleid-signin");
    const email = screen.getByRole("button", { name: "이메일로 계속하기" });
    expect(apple).not.toBeNull();
    // Apple's renderer draws the title from `data-type`, so the page sets no text of its own.
    expect(apple).toHaveAttribute("data-type", "continue");
    expect(apple).toBeEmptyDOMElement();
    expect(
      google.compareDocumentPosition(apple as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      (apple as Node).compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // Each is 48 high through the one token, and as wide as the others, centred.
    expect(globalsCss).toMatch(/--spacing-google-height: 48px;/);
    expect(globalsCss).toMatch(/--container-sign-in: 375px;/);
    expect(google).toHaveClass("min-h-google-height", "w-full", "max-w-sign-in", "self-center");
    expect(email).toHaveClass("min-h-google-height", "w-full", "max-w-sign-in", "self-center");
    expect(apple).toHaveClass("h-google-height");
    expect(apple?.parentElement).toHaveClass("w-full", "max-w-sign-in", "self-center");

    // 12 between the buttons, and 16 between the group and the legal links under it.
    const group = google.parentElement?.parentElement;
    expect(group).toHaveClass("gap-3");
    expect(group?.parentElement).toHaveClass("gap-4");
    expect(group?.contains(email)).toBe(true);
    expect(group?.parentElement?.contains(screen.getByRole("link", { name: "이용약관" }))).toBe(
      true,
    );
  });
});
