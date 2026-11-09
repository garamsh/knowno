import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readCardMarkup } from "@/features/admin";
import { setCardMarkup } from "@/features/admin/actions";
import { FakeAdmin } from "@/testing/mocks/admin";
import { otherUser, supabaseUrl, testUser } from "@/testing/mocks/handlers";
import { server } from "@/testing/mocks/server";
import { setRequestCookies } from "@/testing/next-headers";
import { render } from "@/testing/render";
import { signedInCookies } from "@/testing/session";

import { AdminsContent, AssistantContent } from "../_components/content";

vi.mock("next/headers", () => import("@/testing/next-headers"));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => "/assistant",
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

async function signIn(user: typeof testUser | typeof otherUser = testUser) {
  setRequestCookies([...(await signedInCookies(user)), { name: "smartman-tz", value: "UTC" }]);
}

let admin: FakeAdmin;

/** 말랑이 as the address [params] opens it. */
const assistant = (params: Record<string, string> = {}) =>
  render(AssistantContent, { searchParams: Promise.resolve(params) });

beforeEach(async () => {
  admin = new FakeAdmin();
  server.use(...admin.handlers);
  await signIn();
});

describe("the card markup switch on 말랑이", () => {
  it("shows the switch off with nobody having set it, and the condition for turning it on", async () => {
    await assistant();
    const section = within(screen.getByRole("region", { name: "카드 마크업" }));
    expect(section.getByText("꺼짐")).toBeInTheDocument();
    expect(section.getByText("아직 바꾼 적 없어요")).toBeInTheDocument();
    expect(
      section.getByText(/글 버전 3과 빈칸 버전 2를 읽는 앱이 TestFlight에 있어야 해요/),
    ).toBeInTheDocument();
    expect(section.getByRole("button", { name: "마크업 켜기" })).toBeInTheDocument();
    expect(section.queryByRole("button", { name: "마크업 끄기" })).toBeNull();
  });

  it("says a switch no admin changed was never changed, and not that of one changed by an account that is gone", async () => {
    await assistant();
    const never = within(screen.getByRole("region", { name: "카드 마크업" }));
    expect(never.getByText("아직 바꾼 적 없어요")).toBeInTheDocument();
    // Control: the case below is not read as this one.
    expect(never.queryByText(/삭제된 계정/)).toBeNull();
  });

  it("shows when a switch was changed by an account that is gone, with that said, and not as never changed", async () => {
    admin.cardMarkup = { enabled: false, everSet: true, by: null, at: "2026-11-09T05:00:00Z" };
    await assistant();
    const section = within(screen.getByRole("region", { name: "카드 마크업" }));
    expect(section.getByText(/ · 삭제된 계정$/)).toBeInTheDocument();
    // Control: it is not the sentence for a switch nobody changed.
    expect(section.queryByText("아직 바꾼 적 없어요")).toBeNull();
  });

  it("reads a row without a boolean ever_set as unreadable, against the row with one", async () => {
    const row = { enabled: false, set_by_email: null, set_at: "2026-11-09T01:00:00Z" };
    const answer = (value: Record<string, unknown>) => {
      server.use(
        http.post(`${supabaseUrl}/rest/v1/rpc/admin_card_markup`, () => HttpResponse.json([value])),
      );
    };
    answer({ ...row, ever_set: false });
    expect(await readCardMarkup()).toMatchObject({ data: { everSet: false } });
    answer(row);
    expect(await readCardMarkup()).toEqual({ failure: "unreadable" });
    answer({ ...row, ever_set: "true" });
    expect(await readCardMarkup()).toEqual({ failure: "unreadable" });
  });

  it("asks before it turns the switch on, then shows it on with who set it, and offers to turn it off", async () => {
    const user = userEvent.setup();
    await assistant();
    await user.click(screen.getByRole("button", { name: "마크업 켜기" }));
    expect(screen.getByText(/^마크업을 켤까요\?/)).toBeInTheDocument();
    // Control: asking changes nothing.
    expect(admin.cardMarkup.enabled).toBe(false);
    await user.click(screen.getByRole("button", { name: "켜기" }));
    expect(
      await screen.findByText("마크업을 켰어요. 다음 카드부터 새 형식으로 써요."),
    ).toBeInTheDocument();
    expect(admin.cardMarkup).toMatchObject({ enabled: true, by: testUser.id });
    cleanup();
    await assistant();
    const section = within(screen.getByRole("region", { name: "카드 마크업" }));
    expect(section.getByText("켜짐")).toBeInTheDocument();
    expect(section.getByText(new RegExp(testUser.email))).toBeInTheDocument();
    expect(section.getByRole("button", { name: "마크업 끄기" })).toBeInTheDocument();
  });

  it("turns it on and off through the server, records each, and reads a value it already has as no change", async () => {
    expect(await setCardMarkup(true)).toEqual({
      changed: true,
      message: "마크업을 켰어요. 다음 카드부터 새 형식으로 써요.",
    });
    expect(await setCardMarkup(true)).toEqual({ changed: false, message: "이미 켜져 있어요." });
    expect(await setCardMarkup(false)).toEqual({
      changed: true,
      message: "마크업을 껐어요. 이미 쓴 카드는 그대로예요.",
    });
    expect(await setCardMarkup(false)).toEqual({ changed: false, message: "이미 꺼져 있어요." });
    expect(admin.audit.map((entry) => [entry.action, entry.detail])).toEqual([
      ["set_card_markup", { enabled: false, enabled_before: true }],
      ["set_card_markup", { enabled: true, enabled_before: false }],
    ]);
    await render(AdminsContent, {});
    const log = within(screen.getByRole("list", { name: "작업 기록" }));
    expect(log.getAllByRole("listitem").map((entry) => entry.firstChild?.textContent)).toEqual([
      "카드 마크업 스위치 · 카드 마크업 · 끄기",
      "카드 마크업 스위치 · 카드 마크업 · 켜기",
    ]);
    expect(log.getAllByRole("link", { name: "카드 마크업" })[0]).toHaveAttribute(
      "href",
      "/assistant",
    );
  });

  it("reads an answer the control cannot cause as a refusal and changes nothing", async () => {
    server.use(
      http.post(`${supabaseUrl}/rest/v1/rpc/admin_set_card_markup`, () =>
        HttpResponse.json("bad_value"),
      ),
    );
    expect(await setCardMarkup(true)).toEqual({
      changed: false,
      message: "하지 못했어요. 잠시 후 다시 시도해 주세요.",
    });
    expect(admin.cardMarkup.enabled).toBe(false);
  });

  it("gives a user who is not an admin neither the control nor the function", async () => {
    await signIn(otherUser);
    await assistant();
    expect(screen.getByText("관리자만 볼 수 있어요.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "마크업 켜기" })).toBeNull();
    expect(await setCardMarkup(true)).toEqual({
      changed: false,
      message: "관리자만 할 수 있어요.",
    });
    // Control: the same call as the admin changes it.
    expect(admin.cardMarkup.enabled).toBe(false);
    await signIn();
    expect(await setCardMarkup(true)).toMatchObject({ changed: true });
    expect(admin.cardMarkup.enabled).toBe(true);
  });
});
