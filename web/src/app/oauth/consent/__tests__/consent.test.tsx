import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bearerUser, supabaseUnreachable, supabaseUrl, testUser } from "@/testing/mocks/handlers";
import { server } from "@/testing/mocks/server";
import { setRequestCookies } from "@/testing/next-headers";
import { redirectTarget } from "@/testing/redirect";
import { render } from "@/testing/render";
import { signedInCookies } from "@/testing/session";
import { typeSizesOf } from "@/testing/type-sizes";

import { myPlan, planRow } from "@/testing/mocks/my-plan";

import { Consent } from "../_components/consent";

vi.mock("next/headers", () => import("@/testing/next-headers"));

const approveAuthorization = vi.fn();
const denyAuthorization = vi.fn();
vi.mock("@/supabase/browser", () => ({
  createClient: () => ({ auth: { oauth: { approveAuthorization, denyAuthorization } } }),
}));

const pending = "pendingauthorization1";
const answered = "answeredauthorization1";
const loopback = "loopbackauthorization1";
const back = "https://claude.ai/api/mcp/auth_callback?code=c0de&state=s";

/** The ids the details endpoint read, so a test can show none was asked for. */
let read: string[] = [];

/**
 * Supabase Auth's authorization details for the signed-in user: [pending] and [loopback] need
 * consent, [answered] was allowed before, and any other id is not found.
 */
const details = http.get(
  `${supabaseUrl}/auth/v1/oauth/authorizations/:id`,
  ({ request, params }) => {
    const id = String(params.id);
    read.push(id);
    if (bearerUser(request.headers.get("authorization")) === null) {
      return HttpResponse.json({ code: 401, error_code: "no_authorization" }, { status: 401 });
    }
    if (id === answered) return HttpResponse.json({ redirect_url: back });
    if (id !== pending && id !== loopback) {
      return HttpResponse.json(
        { code: 404, error_code: "oauth_authorization_not_found", msg: "authorization not found" },
        { status: 404 },
      );
    }
    return HttpResponse.json({
      authorization_id: id,
      redirect_uri:
        id === pending
          ? "https://claude.ai/api/mcp/auth_callback"
          : "http://localhost:3118/callback",
      client: { id: "client", name: "Claude" },
      user: testUser,
      scope: "email",
    });
  },
);

async function open(id: string | undefined) {
  return render(Consent, {
    searchParams: Promise.resolve(id === undefined ? {} : { authorization_id: id }),
  });
}

describe("the consent page", () => {
  const assign = vi.fn();
  beforeEach(async () => {
    read = [];
    approveAuthorization.mockReset();
    denyAuthorization.mockReset();
    assign.mockReset();
    // The form reads nothing of the location but sends the browser on through `assign`.
    vi.stubGlobal("location", { assign });
    setRequestCookies(await signedInCookies());
    server.use(details);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks whether to connect the app, stating the account, the address it returns to and what it may do", async () => {
    await open(pending);

    expect(screen.getByRole("heading", { level: 1, name: "Claude에 연결할까요?" })).toBeVisible();
    const group = screen.getByRole("region", { name: "연결 내용" });
    expect(within(group).getByText(testUser.email)).toBeVisible();
    expect(within(group).getByText("claude.ai")).toBeVisible();
    expect(
      within(group).getByText("노트와 카드를 읽고, 추가하고, 고치고, 지울 수 있어요."),
    ).toBeVisible();
    expect(screen.queryByText(/이 컴퓨터 안의 프로그램/)).not.toBeInTheDocument();
    expect(read).toEqual([pending]);
  });

  it("draws the request as one group, 취소 quiet and 연결 the one primary fill last, in three type sizes", async () => {
    const { container } = await open(pending);

    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["취소", "연결"]);
    expect(buttons[0]).toHaveClass("bg-surface");
    expect(buttons[0]).not.toHaveClass("bg-primary");
    expect(buttons[1]).toHaveClass("bg-primary", "text-on-primary");
    expect(container.querySelectorAll(".rounded-group")).toHaveLength(1);
    expect(typeSizesOf(container).length).toBeLessThanOrEqual(3);
  });

  it("warns that a loopback address is a program on this computer, against claude.ai's address with no warning", async () => {
    await open(loopback);
    expect(screen.getByText("localhost:3118")).toBeVisible();
    expect(
      screen.getByText(
        "이 주소는 이 컴퓨터 안의 프로그램이에요. 직접 시작한 프로그램일 때만 연결해 주세요.",
      ),
    ).toBeVisible();
  });

  it("sends the browser back to the app with Supabase Auth's address once 연결 is pressed", async () => {
    approveAuthorization.mockResolvedValue({ data: { redirect_url: back }, error: null });
    await open(pending);

    await userEvent.click(screen.getByRole("button", { name: "연결" }));

    expect(approveAuthorization).toHaveBeenCalledWith(pending, { skipBrowserRedirect: true });
    expect(denyAuthorization).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith(back);
  });

  it("shows MCP locked on 무료, with only 취소, and grants nothing even if 연결 is pressed", async () => {
    server.use(myPlan(planRow("free")));
    await open(pending);

    expect(screen.getByText(/AI 연결은 플러스부터 쓸 수 있어요/)).toBeVisible();
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["취소"]);
    expect(screen.queryByRole("button", { name: "연결" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(approveAuthorization).not.toHaveBeenCalled();
  });

  it("refuses a 무료 user's 취소 through Supabase Auth", async () => {
    const refused = "https://claude.ai/api/mcp/auth_callback?error=access_denied";
    denyAuthorization.mockResolvedValue({ data: { redirect_url: refused }, error: null });
    server.use(myPlan(planRow("free")));
    await open(pending);

    await userEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(denyAuthorization).toHaveBeenCalledWith(pending, { skipBrowserRedirect: true });
    expect(approveAuthorization).not.toHaveBeenCalled();
  });

  it("offers 연결 as before to a paid user, a 무제한 user and an admin", async () => {
    for (const kind of ["plus-store", "unlimited", "admin"] as const) {
      server.use(myPlan(planRow(kind)));
      const { unmount } = await open(pending);
      expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
        "취소",
        "연결",
      ]);
      expect(screen.queryByText(/AI 연결은 플러스부터/)).not.toBeInTheDocument();
      unmount();
    }
  });

  it("refuses through Supabase Auth when 취소 is pressed, and grants nothing", async () => {
    const refused = "https://claude.ai/api/mcp/auth_callback?error=access_denied";
    denyAuthorization.mockResolvedValue({ data: { redirect_url: refused }, error: null });
    await open(pending);

    await userEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(denyAuthorization).toHaveBeenCalledWith(pending, { skipBrowserRedirect: true });
    expect(approveAuthorization).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith(refused);
  });

  it("says the connection failed and keeps both buttons when Supabase Auth refuses the answer", async () => {
    approveAuthorization.mockResolvedValue({ data: null, error: new Error("expired") });
    await open(pending);

    await userEvent.click(screen.getByRole("button", { name: "연결" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "연결하지 못했어요. AI 앱에서 다시 연결해 주세요.",
    );
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "연결" })).toBeEnabled();
  });

  it("sends the browser straight back to the app for a request the user allowed before", async () => {
    expect(await redirectTarget(open(answered))).toBe(back);
  });

  it("says the request was not found for an id Supabase Auth does not know", async () => {
    await open("unknownauthorization");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "연결 요청을 찾을 수 없어요. AI 앱에서 다시 연결해 주세요.",
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("refuses a missing or malformed id before any request, as it reads a well-formed one", async () => {
    // Each would reach the details endpoint unchecked: none is a path the URL rewrites.
    await open(undefined);
    await open("bad.id");
    await open("a b");
    expect(screen.getAllByRole("alert")).toHaveLength(3);
    expect(read).toEqual([]);
    await open(pending);
    expect(read).toEqual([pending]);
  });

  it("says the server cannot be reached, with 다시 시도, while Supabase Auth cannot be reached", async () => {
    server.use(supabaseUnreachable);
    await open(pending);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "서버에 연결할 수 없어요. 연결을 확인하고 다시 시도해 주세요.",
    );
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeVisible();
  });
});
