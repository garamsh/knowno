import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { render } from "@/testing/render";

import LoginPage from "../page";

vi.mock("@/supabase/browser", () => ({
  createClient: () => ({ auth: { signInWithOAuth: vi.fn() } }),
}));

// Apple's script, which draws its button, is not loaded here; the wrapper it draws into is.
vi.mock("next/script", () => ({ default: () => null }));

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
    expect(screen.getByRole("button", { name: "Google로 로그인" })).toBeEnabled();
    expect(document.getElementById("appleid-signin")).toHaveAttribute("data-type", "sign-in");
    expect(
      screen.getByText("계속하면 이용약관과 개인정보 처리방침에 동의하는 것으로 봐요."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "이용약관" })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: "개인정보 처리방침" })).toHaveAttribute(
      "href",
      "/privacy",
    );
  });
});
