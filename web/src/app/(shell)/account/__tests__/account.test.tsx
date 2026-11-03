import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EmptyHome } from "@/features/decks";
import { FakePostgrest } from "@/testing/mocks/postgrest";
import { supabaseUnreachable, testUser } from "@/testing/mocks/handlers";
import { server } from "@/testing/mocks/server";
import { setRequestCookies } from "@/testing/next-headers";
import { redirectTarget } from "@/testing/redirect";
import { render } from "@/testing/render";
import { signedInCookies } from "@/testing/session";

import { Profile } from "../_components/profile";
import AccountPage from "../page";

vi.mock("next/headers", () => import("@/testing/next-headers"));

/** The mark's drawing, as `Mascot` draws its thinking expression. */
const mascot = 'img[src*="knowno-thinking"]';

describe("the account page", () => {
  beforeEach(async () => {
    setRequestCookies(await signedInCookies());
    // The rows its 학습 section reads.
    server.use(...new FakePostgrest().handlers);
  });

  it("reads the session on the server and shows who is signed in, with sign-out", async () => {
    await render(Profile, {});

    // The email alone, with no avatar beside it, then 로그아웃, in the one group of 계정.
    expect(screen.getByRole("region", { name: "계정" })).toHaveTextContent(
      new RegExp(`^계정${testUser.email}로그아웃$`),
    );
    expect(screen.getByRole("button", { name: "로그아웃" })).toBeEnabled();
  });

  it("draws 계정, 학습, AI 연결 and 화면 in that order, each one group of hairline rows, its rows words alone", async () => {
    await render(Profile, {});

    const sections = screen.getAllByRole("region");
    // Each is named by its label.
    expect(
      sections.map(
        (section) =>
          document.getElementById(section.getAttribute("aria-labelledby") ?? "")?.textContent,
      ),
    ).toEqual(["계정", "학습", "AI 연결", "화면"]);
    expect(sections.map((section) => section.querySelector("h2")?.textContent)).toEqual([
      "계정",
      "학습",
      "AI 연결",
      "화면",
    ]);
    for (const section of sections) {
      // The outermost element of the group's radius is the group, on the surface.
      const group = section.querySelector(".rounded-group");
      expect(group).toHaveClass("bg-surface");
      // No row in a group draws a surface or a shadow of its own.
      expect(group?.querySelector('[class*="bg-surface"], [class*="shadow"]')).toBeNull();
    }
    // 로그아웃 and 하루 학습 시간 are their words, the latter with its minutes and chevron alone.
    expect(screen.getByRole("button", { name: "로그아웃" }).querySelector("svg")).toBeNull();
    expect(
      screen.getByRole("button", { name: /^하루 학습 시간/ }).querySelectorAll("svg"),
    ).toHaveLength(1);
  });

  it("says the server cannot be reached when Supabase does not answer", async () => {
    server.use(supabaseUnreachable);

    await render(Profile, {});

    expect(screen.getByRole("alert")).toHaveTextContent(
      "서버에 연결할 수 없어요. 연결을 확인하고 다시 시도해 주세요.",
    );
    // The next step, and the theme choice, which needs no server.
    expect(
      within(screen.getByRole("alert")).getByRole("button", { name: "다시 시도" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "화면" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "AI 연결" })).toHaveTextContent(
      "https://api.knowno.app/functions/v1/mcp",
    );
  });

  it("states the MCP server's address and how to add it in Claude and in ChatGPT under AI 연결", async () => {
    await render(Profile, {});

    const section = within(screen.getByRole("region", { name: "AI 연결" }));
    expect(section.getByText("서버 주소").nextElementSibling).toHaveTextContent(
      /^https:\/\/api\.knowno\.app\/functions\/v1\/mcp$/,
    );
    expect(section.getByText("Claude").nextElementSibling).toHaveTextContent(
      "커넥터 설정에서 커스텀 커넥터를 추가하고 서버 주소를 넣은 뒤 알아몰라로 로그인해요",
    );
    expect(section.getByText("ChatGPT").nextElementSibling).toHaveTextContent(
      "chatgpt.com/plugins에서 커스텀 MCP 서버를 추가하고 서버 주소를 넣은 뒤 알아몰라로 로그인해요",
    );
    // What a connection may do; substring, inside the note.
    expect(
      section.getByText(/노트와 카드를 읽고, 추가하고, 고치고, 지울 수 있어요\./),
    ).toBeVisible();
  });

  it("redirects to /login without a session", async () => {
    setRequestCookies([]);

    expect(await redirectTarget(render(Profile, {}))).toBe("/login");
  });

  it("is titled 설정, with no mascot, and links to the terms and the privacy policy at its foot", async () => {
    const { container } = await render(AccountPage, {});

    expect(screen.getByRole("heading", { level: 1, name: "설정" })).toBeInTheDocument();
    expect(container.querySelector(mascot)).toBeNull();
    // Control: the selector finds the mascot where the first-run home draws it.
    const firstRun = await render(EmptyHome, {});
    expect(firstRun.container.querySelector(mascot)).not.toBeNull();
    firstRun.unmount();

    const links = within(screen.getByRole("navigation", { name: "약관" }));
    expect(links.getByRole("link", { name: "이용약관" })).toHaveAttribute("href", "/terms");
    expect(links.getByRole("link", { name: "개인정보 처리방침" })).toHaveAttribute(
      "href",
      "/privacy",
    );
  });
});
