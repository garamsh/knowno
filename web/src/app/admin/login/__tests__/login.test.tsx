import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { render } from "@/testing/render";

import AdminLoginPage from "../page";

vi.mock("@/supabase/browser", () => ({
  createClient: () => ({ auth: { signInWithOAuth: vi.fn() } }),
}));

describe("the admin host's sign-in", () => {
  it("shows the brand over 관리, what it is, and Google's button, with none of the service's links", async () => {
    await render(AdminLoginPage, {
      params: Promise.resolve({}),
      searchParams: Promise.resolve({}),
    });

    expect(screen.getByRole("heading", { level: 1, name: "관리자 로그인" })).toBeInTheDocument();
    expect(screen.getByText("관리")).toBeInTheDocument();
    expect(
      screen.getByText("관리자 계정으로 로그인해 주세요. 서비스의 로그인과는 따로예요."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Google로 로그인" })).toBeEnabled();
    // The legal pages are the service's, which the admin host does not open.
    expect(screen.queryByRole("link")).toBeNull();
  });
});
