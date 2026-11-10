import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { http, HttpResponse } from "msw";

import {
  createPlanVersion,
  dismissReports,
  grantPlan,
  revokePlan,
  grantAdmin,
  hideDeck,
  removeDeck,
  revokeAdmin,
  suspendUser,
  unpublishDeck,
  unsuspendUser,
} from "@/features/admin/actions";
import { readUser } from "@/features/admin";
import { FakeAdmin } from "@/testing/mocks/admin";
import { otherUser, supabaseUrl, testUser } from "@/testing/mocks/handlers";
import { server } from "@/testing/mocks/server";
import { setRequestCookies, setRequestHeaders } from "@/testing/next-headers";
import { testRouter } from "@/testing/router";
import { render } from "@/testing/render";
import { signedInCookies } from "@/testing/session";

import { AdminGate } from "../_components/admin-gate";
import {
  AdminsContent,
  DeckContent,
  NotesContent,
  PlansContent,
  TodoContent,
  UserContent,
  UsersContent,
} from "../_components/content";

vi.mock("next/headers", () => import("@/testing/next-headers"));
// The admin host's path the menus read; `/decks` unless a test moves it.
const pathname = vi.hoisted(() => ({ current: "/decks" }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => pathname.current,
  useRouter: () => testRouter,
}));
const revalidated = vi.hoisted(() => [] as string[]);
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    revalidated.push(path);
  },
}));

const notFound = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };
const french = "d0000000-0000-4000-8000-0000000000f1";
const diary = "d0000000-0000-4000-8000-0000000000f2";
const stored = "d0000000-0000-4000-8000-0000000000f3";
const german = "d0000000-0000-4000-8000-0000000000f4";
const latin = "d0000000-0000-4000-8000-0000000000f5";
const day = 86_400_000;

/** Signs the next request in as [user], with the browser's zone UTC. */
async function signIn(user: typeof testUser | typeof otherUser = testUser) {
  setRequestCookies([...(await signedInCookies(user)), { name: "smartman-tz", value: "UTC" }]);
}

let admin: FakeAdmin;
beforeEach(async () => {
  revalidated.length = 0;
  pathname.current = "/decks";
  admin = new FakeAdmin();
  server.use(...admin.handlers);
  admin.seedDeck({
    id: french,
    name: "French",
    copies: 3,
    cards: [
      { id: "c1", front: "chat", back: "고양이" },
      { id: "c2", front: "chien", back: "개" },
    ],
    reports: [
      { reason: "spam", at: "2026-10-18T01:00:00Z" },
      { reason: "copyright", at: "2026-10-18T02:00:00Z" },
    ],
  });
  admin.seedDeck({ id: diary, name: "Diary", visibility: "private", publishedAt: null });
  await signIn();
});

describe("the admin area's gate", () => {
  it("gives a user who is not an admin one line and nothing of the area, and an admin the admin host's shell", async () => {
    setRequestHeaders({ "x-knowno-service-origin": "https://knowno.app" });
    await signIn(otherUser);
    await render(AdminGate, { children: <p>내용</p> });
    expect(screen.getByRole("heading", { name: "관리자만 들어올 수 있어요." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다른 계정으로 로그인" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByText("내용")).not.toBeInTheDocument();
    // The menu's count is asked beside the check, and the server refuses it.
    expect(admin.calls.map((call) => call.split(" ")[0])).toEqual(["is_admin", "admin_note_list"]);

    // Control: the admin sees the seven sections on the admin host's paths, the current one
    // marked, the account at the foot, and the page; none of the service's menus.
    cleanup();
    await signIn();
    await render(AdminGate, { children: <p>내용</p> });
    expect(screen.queryByRole("heading", { name: "관리자만 들어올 수 있어요." })).toBeNull();
    const menu = screen.getByRole("navigation", { name: "관리 메뉴" });
    expect(
      within(menu)
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      ["처리할 일, 새 신고 1건", "/"],
      ["사용자", "/users"],
      ["노트", "/decks"],
      ["AI", "/ai"],
      ["말랑이", "/assistant"],
      ["요금제", "/plans"],
      ["관리자", "/admins"],
    ]);
    expect(within(menu).getByRole("link", { name: "노트" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.queryByRole("navigation", { name: "주 메뉴" })).toBeNull();
    expect(screen.getByText(testUser.email)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "서비스 열기, 새 탭" })).toHaveAttribute(
      "href",
      "https://knowno.app",
    );
    expect(screen.getByRole("button", { name: "로그아웃" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "메뉴" })).toBeInTheDocument();
    expect(screen.getByText("내용")).toBeInTheDocument();
    // Korean on every page breaks only between words.
    expect(screen.getByRole("main")).toHaveClass("break-keep");
  });

  it("carries no count in the menu while no note others see is reported, or while the count cannot be read", async () => {
    admin.decks[0]?.reports.splice(0);
    await render(AdminGate, { children: <p>내용</p> });
    expect(screen.getByRole("link", { name: "처리할 일" })).toBeInTheDocument();

    cleanup();
    admin.decks[0]?.reports.push({ reason: "spam", at: "2026-10-18T01:00:00Z" });
    server.use(
      http.post(`${supabaseUrl}/rest/v1/rpc/admin_note_list`, () =>
        HttpResponse.json({ code: "P0001", message: "boom" }, { status: 400 }),
      ),
    );
    await render(AdminGate, { children: <p>내용</p> });
    expect(screen.getByRole("link", { name: "처리할 일" })).toBeInTheDocument();
    expect(screen.getByText("내용")).toBeInTheDocument();
  });

  it("gives a revoked admin the one line at once", async () => {
    admin.admins.delete(testUser.id);
    await render(AdminGate, { children: <p>내용</p> });
    expect(screen.getByRole("heading", { name: "관리자만 들어올 수 있어요." })).toBeInTheDocument();
    expect(screen.queryByText("내용")).not.toBeInTheDocument();
  });

  it("marks each section current on its pages, 요금제, 관리자, AI and 말랑이 on their own", async () => {
    const at = async (path: string) => {
      pathname.current = path;
      cleanup();
      await render(AdminGate, { children: <p>내용</p> });
      return within(screen.getByRole("navigation", { name: "관리 메뉴" }))
        .getAllByRole("link", { current: "page" })
        .map((link) => link.textContent);
    };
    expect(await at("/")).toEqual(["처리할 일, 새 신고 1건"]);
    expect(await at("/users/abc")).toEqual(["사용자"]);
    expect(await at("/decks/abc")).toEqual(["노트"]);
    expect(await at("/ai")).toEqual(["AI"]);
    expect(await at("/assistant")).toEqual(["말랑이"]);
    expect(await at("/plans")).toEqual(["요금제"]);
    expect(await at("/admins")).toEqual(["관리자"]);
    expect(
      within(screen.getByRole("navigation", { name: "관리 메뉴" }))
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/", "/users", "/decks", "/ai", "/assistant", "/plans", "/admins"]);
  });

  it("opens the menu as a full screen below 1024 px, and a section's link closes it and opens the section", async () => {
    await render(AdminGate, { children: <p>내용</p> });
    await userEvent.click(screen.getByRole("button", { name: "메뉴" }));
    const screenMenu = screen.getByRole("dialog", { name: "관리 메뉴" });
    expect(screenMenu).toHaveClass("h-dvh", "w-full");
    const sections = within(screenMenu).getByRole("navigation", { name: "관리 메뉴" });
    expect(
      within(sections)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["처리할 일, 새 신고 1건", "사용자", "노트", "AI", "말랑이", "요금제", "관리자"]);
    expect(within(screenMenu).getByRole("button", { name: "로그아웃" })).toBeInTheDocument();

    await userEvent.click(within(sections).getByRole("link", { name: "사용자" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "관리 메뉴" })).toBeNull();
    });
    expect(testRouter.push).toHaveBeenCalledWith("/users");
  });
});

/** The UTC day [offset] days from now, as YYYY-MM-DD. */
const utcDay = (offset = 0) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

describe("처리할 일", () => {
  it("shows the open reports, the week's failure rate and the plans with a draft, each with its one action", async () => {
    admin.extractionFailures = [
      // 2 of 20 failed: 10.0%, over the 5% line.
      {
        day: utcDay(),
        prompt_version_id: 1,
        calls: 20,
        ok: 18,
        no_cards: 0,
        invalid_output: 2,
        model_error: 0,
        retried: 0,
        recovered: 0,
        failure_rate: 0.1,
        unrecorded: 0,
      },
    ];
    for (const plan of ["max", "pro"]) {
      admin.aiConfigurations.push({
        id: admin.aiConfigurations.length + 1,
        plan,
        label: "test",
        provider: "openrouter",
        model: "anthropic/claude-haiku-5.5",
        prompt_version_id: 1,
        created_by: null,
      });
    }
    const now = Date.now();
    await render(TodoContent, {});

    const reports = within(screen.getByRole("region", { name: "새 신고" }));
    expect(reports.getByText("1건")).toBeInTheDocument();
    // French's oldest report, 2026-10-18 01:00 UTC.
    const age = Math.floor((now - Date.parse("2026-10-18T01:00:00Z")) / day);
    expect(reports.getByText(`가장 오래된 신고 ${String(age)}일 전`)).toBeInTheDocument();
    expect(reports.getByRole("link", { name: "신고 보기" })).toHaveAttribute("href", "/decks");

    const failures = within(screen.getByRole("region", { name: "사진 읽기 실패율 · 7일" }));
    expect(failures.getByText("10.0%")).toHaveClass("text-dont-know-text");
    expect(failures.getByRole("link", { name: "자세히" })).toHaveAttribute("href", "/ai");

    const test = within(screen.getByRole("region", { name: "테스트 중인 초안" }));
    // In the plans' order, whichever draft was saved first.
    expect(test.getByText("플러스 · 프로")).toBeInTheDocument();
    expect(test.getByRole("link", { name: "적용 또는 끝내기" })).toHaveAttribute(
      "href",
      "/ai?plan=pro",
    );
    expect(admin.calls).toContain('admin_extraction_failures {"days":7}');
  });

  it("draws a rate of 5% in ink, and says what is true with no report, no recorded call and no test", async () => {
    admin.decks.length = 0;
    await render(TodoContent, {});
    expect(
      within(screen.getByRole("region", { name: "새 신고" })).getByText("처리할 신고가 없어요."),
    ).toBeInTheDocument();
    const failures = within(screen.getByRole("region", { name: "사진 읽기 실패율 · 7일" }));
    expect(failures.getByText("최근 7일에 기록된 추출이 없어요.")).toBeInTheDocument();
    const test = within(screen.getByRole("region", { name: "테스트 중인 초안" }));
    expect(test.getByText("없음")).toBeInTheDocument();
    expect(test.getByText("관리자만 쓰는 초안이 없어요.")).toBeInTheDocument();
    expect(test.getByRole("link", { name: "AI 보기" })).toHaveAttribute("href", "/ai");

    cleanup();
    admin.extractionFailures = [
      {
        day: utcDay(),
        prompt_version_id: 1,
        calls: 20,
        ok: 19,
        no_cards: 0,
        invalid_output: 1,
        model_error: 0,
        retried: 0,
        recovered: 0,
        failure_rate: 0.05,
        unrecorded: 0,
      },
    ];
    await render(TodoContent, {});
    const rate = within(screen.getByRole("region", { name: "사진 읽기 실패율 · 7일" })).getByText(
      "5.0%",
    );
    expect(rate).toHaveClass("text-ink");
    expect(rate).not.toHaveClass("text-dont-know-text");
  });

  it("compares the last 7 days with the 7 before: new users, the daily average who studied, and the photos and their cost", async () => {
    admin.weekActivity = {
      new_users_this: 56,
      new_users_last: 41,
      studied_this: 21,
      studied_last: 14,
    };
    // Haiku, the Free plan's model, is measured at $0.0018 a photo.
    admin.breakdown = [
      {
        day: utcDay(),
        plan: "free",
        model: "anthropic/claude-haiku-5.5",
        prompt_version_id: 1,
        photos: 5,
      },
      { day: utcDay(-8), plan: null, model: null, prompt_version_id: null, photos: 10 },
    ];
    await render(TodoContent, {});

    const week = within(screen.getByRole("region", { name: "이번 주" }));
    // Each row carries its term, last week, this week and the change, so a substring is right.
    expect(week.getByText("새 사용자").closest("div")).toHaveTextContent(
      /새 사용자지난주 41명56명\+37%/,
    );
    expect(week.getByText("학습한 사용자").closest("div")).toHaveTextContent(
      /학습한 사용자하루 평균 · 지난주 2명3명\+50%/,
    );
    expect(week.getByText("읽은 사진 · 예상 비용").closest("div")).toHaveTextContent(
      /지난주 10장 · \$0\.01805장 · \$0\.0090−50%/,
    );
    expect(admin.calls).toContain('admin_week_activity {"time_zone":"UTC"}');
    expect(admin.calls).toContain('admin_extraction_breakdown {"days":14}');
  });

  it("shows no change beside a figure whose week before was 0", async () => {
    admin.weekActivity = { new_users_this: 3, new_users_last: 0, studied_this: 0, studied_last: 0 };
    await render(TodoContent, {});
    const row = within(screen.getByRole("region", { name: "이번 주" }))
      .getByText("새 사용자")
      .closest("div");
    expect(row).toHaveTextContent(/^새 사용자지난주 0명3명$/);
  });

  it("says a user who is not an admin may not see it", async () => {
    await signIn(otherUser);
    await render(TodoContent, {});
    expect(screen.getByRole("alert")).toHaveTextContent("관리자만 볼 수 있어요.");
    expect(screen.queryByRole("region", { name: "새 신고" })).not.toBeInTheDocument();
  });
});

const notes = (params: Record<string, string> = {}) =>
  render(NotesContent, { searchParams: Promise.resolve(params) });

/** The rows of 노트's table, under its header row. */
const noteRows = () =>
  within(screen.getByRole("table", { name: "노트 목록" }))
    .getAllByRole("row")
    .slice(1);

describe("노트", () => {
  beforeEach(() => {
    admin.seedDeck({ id: german, name: "German", publishedAt: "2026-10-18T00:00:00Z" });
    admin.seedDeck({
      id: latin,
      name: "Latin",
      hidden: true,
      reports: [{ reason: "spam", at: "2026-10-16T00:00:00Z" }],
    });
  });

  it("opens on the reported notes others still see, with the count in the switch, each name opening its cards, and two fixed actions and ⋯ on each", async () => {
    await notes();
    const views = within(screen.getByRole("navigation", { name: "노트 보기" }));
    expect(views.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "신고된 노트 1",
      "모든 공개 노트",
      "숨긴 노트",
      "검토 중 0",
      "금칙어",
      "AI가 처리한 것",
      "신고 AI 설정",
    ]);
    expect(views.getByRole("link", { name: "신고된 노트 1" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    expect(
      within(screen.getByRole("table", { name: "노트 목록" }))
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["노트", "만든 사람", "카드", "가져오기", "첫 신고", "신고", "작업"]);
    const [row] = noteRows();
    expect(
      within(row as HTMLElement)
        .getAllByRole("cell")
        .slice(0, 6)
        .map((cell) => cell.textContent),
    ).toEqual([
      "French사유: 저작권 침해, 스팸AI가 아직 판단하지 않았어요.",
      "만든 사람 other@example.com",
      "카드 2장",
      "가져오기 3회",
      "첫 신고 2026-10-18",
      "신고 2",
    ]);
    // Latin is reported but hidden, German has no report, Diary is private.
    for (const name of ["Latin", "German", "Diary"]) {
      expect(screen.queryByText(name)).not.toBeInTheDocument();
    }
    const name = within(row as HTMLElement).getByRole("link", { name: "French" });
    expect(name).toHaveAttribute("href", `/decks/${french}`);
    // A tap target high, its text centred in it.
    expect(name).toHaveClass("min-h-tap-target", "items-center");
    expect(
      within(row as HTMLElement)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label") ?? button.textContent),
    ).toEqual(["문제없음", "숨기기", "'French' 더 보기"]);
    expect(admin.calls).toContain('admin_note_list {"view":"reported","search":""}');
  });

  it("opens 만든 사람 보기 and 공유에서 영구 삭제 in a sheet from ⋯", async () => {
    const user = userEvent.setup();
    await notes();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "'French' 더 보기" }));
    const menu = within(screen.getByRole("dialog", { name: "French" }));
    expect(menu.getByRole("link", { name: "만든 사람 보기" })).toHaveAttribute(
      "href",
      `/users/${otherUser.id}`,
    );
    await user.click(menu.getByRole("button", { name: "공유에서 영구 삭제" }));
    // The removal keeps its red final step.
    expect(screen.getByRole("button", { name: "영구 삭제" }).className).toContain(
      "bg-dont-know-text",
    );
  });

  it("asks before it hides a note, does nothing on 취소, and records the hide once confirmed", async () => {
    const user = userEvent.setup();
    await notes();
    await user.click(screen.getByRole("button", { name: "숨기기" }));
    const question = screen.getByRole("group", { name: "'French' 노트를 공개 목록에서 숨길까요?" });
    expect(within(question).getByRole("button", { name: "숨기기" })).toHaveFocus();
    // A reversible action's confirm comes last, after 취소, in the primary fill.
    expect(
      within(question)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["취소", "숨기기"]);
    expect(within(question).getByRole("button", { name: "숨기기" }).className).toContain(
      "bg-primary",
    );
    await user.click(within(question).getByRole("button", { name: "취소" }));
    expect(admin.decks[0]?.hidden).toBe(false);
    expect(admin.calls.some((call) => call.startsWith("admin_set_deck_hidden"))).toBe(false);

    await user.click(screen.getByRole("button", { name: "숨기기" }));
    await user.click(
      within(screen.getByRole("group", { name: /숨길까요/ })).getByRole("button", {
        name: "숨기기",
      }),
    );
    expect(await screen.findByText("노트를 숨겼어요.")).toHaveAttribute("role", "status");
    expect(admin.decks[0]?.hidden).toBe(true);
    expect(admin.audit).toMatchObject([{ action: "hide_deck", target_id: french }]);
    expect(revalidated).toEqual(["/admin"]);

    // The hidden note leaves the reported view for the hidden one.
    cleanup();
    await notes();
    expect(screen.queryByText("French")).not.toBeInTheDocument();
  });

  it("clears a note's reports on 문제없음, which a note without a report cannot press", async () => {
    const user = userEvent.setup();
    await notes();
    await user.click(screen.getByRole("button", { name: "문제없음" }));
    await user.click(
      within(screen.getByRole("group", { name: /신고 2건을 정리할까요/ })).getByRole("button", {
        name: "문제없음",
      }),
    );
    expect(await screen.findByText("신고 2건을 정리했어요.")).toBeInTheDocument();
    expect(admin.decks[0]?.reports).toEqual([]);

    cleanup();
    await notes({ view: "public", q: "german" });
    expect(screen.getByRole("button", { name: "문제없음" })).toBeDisabled();
    // Control: a reported note's 문제없음 can be pressed.
    cleanup();
    await notes({ view: "public", q: "latin" });
    expect(screen.getByRole("button", { name: "문제없음" })).toBeEnabled();
  });

  it("lists every public note and the hidden ones in their views, a hidden one offering 숨김 해제", async () => {
    await notes({ view: "public" });
    expect(noteRows().map((row) => /^(German|French|Latin)/.exec(row.textContent)?.[0])).toEqual([
      "German",
      "French",
      "Latin",
    ]);
    expect(
      within(screen.getByRole("navigation", { name: "노트 보기" })).getByRole("link", {
        name: "모든 공개 노트",
      }),
    ).toHaveAttribute("aria-current", "page");

    cleanup();
    await notes({ view: "hidden" });
    const [row] = noteRows();
    expect(row).toHaveTextContent(/^Latin숨김/);
    expect(row).toHaveTextContent(/신고 1/);
    expect(
      within(row as HTMLElement).getByRole("button", { name: "숨김 해제" }),
    ).toBeInTheDocument();
    expect(
      within(row as HTMLElement).queryByRole("button", { name: "숨기기" }),
    ).not.toBeInTheDocument();
  });

  it("searches by the note's name or its owner's email, keeping the view, and says when nothing matches", async () => {
    await notes({ view: "public", q: "OTHER@" });
    expect(noteRows()).toHaveLength(3);
    expect(admin.calls).toContain('admin_note_list {"view":"public","search":"OTHER@"}');
    // The switch keeps the search, and the form the view.
    expect(screen.getByRole("link", { name: "숨긴 노트" })).toHaveAttribute(
      "href",
      "/decks?view=hidden&q=OTHER%40",
    );
    expect(screen.getByRole("search")).toHaveFormValues({ view: "public", q: "OTHER@" });

    cleanup();
    await notes({ q: "spanish" });
    expect(screen.getByText("찾는 노트가 없어요. 다른 단어로 검색해 보세요.")).toBeInTheDocument();
  });

  it("says when there is no report to handle", async () => {
    admin.decks.length = 0;
    await notes();
    expect(
      screen.getByText("처리할 신고가 없어요. 새 신고가 들어오면 여기에 보여요."),
    ).toBeInTheDocument();
  });

  it("says a user who is not an admin may not see it", async () => {
    await signIn(otherUser);
    await notes();
    expect(screen.getByRole("alert")).toHaveTextContent("관리자만 볼 수 있어요.");
    expect(screen.queryByRole("table", { name: "노트 목록" })).not.toBeInTheDocument();
  });
});

describe("the moderation actions", () => {
  it("are refused for a user who is not an admin, and change nothing", async () => {
    await signIn(otherUser);
    for (const action of [hideDeck, unpublishDeck, dismissReports]) {
      expect(await action(french)).toEqual({ changed: false, message: "관리자만 할 수 있어요." });
    }
    expect(admin.decks[0]).toMatchObject({ hidden: false, visibility: "public" });
    expect(admin.decks[0]?.reports).toHaveLength(2);
    expect(admin.audit).toEqual([]);
    expect(revalidated).toEqual([]);
  });

  it("each change the deck for an admin, and say when there was nothing to change", async () => {
    expect(await hideDeck(french)).toEqual({ changed: true, message: "노트를 숨겼어요." });
    expect(await hideDeck(french)).toEqual({ changed: false, message: "이미 숨겨진 노트예요." });
    expect(await unpublishDeck(french)).toEqual({ changed: true, message: "비공개로 바꿨어요." });
    expect(await unpublishDeck(french)).toEqual({
      changed: false,
      message: "이미 비공개인 노트예요.",
    });
    expect(await dismissReports(french)).toEqual({
      changed: true,
      message: "신고 2건을 정리했어요.",
    });
    expect(await dismissReports(french)).toEqual({
      changed: false,
      message: "정리할 신고가 없어요.",
    });
    expect(admin.audit.map((entry) => entry.action)).toEqual([
      "dismiss_reports",
      "unpublish_deck",
      "hide_deck",
    ]);
  });

  it("refuse an id that is not a deck's without asking the server", async () => {
    expect(await hideDeck("not-an-id")).toMatchObject({ changed: false });
    expect(admin.calls).toEqual([]);
  });

  it("refuse a deck's or a user's id that is not a uuid without asking the server, and a user page with one is not found", async () => {
    for (const result of [
      await removeDeck("not-an-id", "spam"),
      await suspendUser("not-an-id", "spam"),
      await unsuspendUser(`${otherUser.id}x`),
    ]) {
      expect(result).toMatchObject({ changed: false });
    }
    expect(admin.calls).toEqual([]);
    await expect(
      render(UserContent, { params: Promise.resolve({ id: "nope" }) }),
    ).rejects.toMatchObject(notFound);
    // Control: a well-formed id reaches the server.
    expect(await suspendUser(otherUser.id, "spam")).toMatchObject({ changed: true });
  });
});

describe("a deck's page", () => {
  it("shows a reported deck read-only with its cards and actions", async () => {
    await render(DeckContent, { params: Promise.resolve({ id: french }) });
    expect(screen.getByRole("heading", { name: "French" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "other@example.com" })).toHaveAttribute(
      "href",
      `/users/${otherUser.id}`,
    );
    const cards = within(screen.getByRole("region", { name: "카드" }));
    expect(cards.getAllByRole("listitem").map((card) => card.textContent)).toEqual([
      "chat고양이",
      "chien개",
    ]);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("describes a card by every 칸, for an earlier card and a free v2 card", async () => {
    const senses = [{ labels: [], meaning: "사과", examples: [] }];
    admin.seedDeck({
      id: stored,
      name: "Stored",
      cards: [
        { id: "earlier", front: "chat", back: "고양이" },
        {
          id: "glue",
          front: [{ type: "text", v: 2, payload: { front: "chien", back: "개" } }],
          back: [],
        },
        {
          id: "word",
          front: [{ type: "senses", v: 2, payload: { term: "apple", ask: "term", senses } }],
          back: [],
        },
        {
          id: "blank",
          front: [
            { type: "cloze", v: 1, payload: { text: "___ is red.", answers: ["Rose"] } },
            { type: "text", v: 2, payload: { front: "", back: "A flower." } },
          ],
          back: [],
        },
      ],
    });
    await render(DeckContent, { params: Promise.resolve({ id: stored }) });

    const cards = within(screen.getByRole("region", { name: "카드" }));
    expect(cards.getAllByRole("listitem").map((card) => card.textContent)).toEqual([
      "chat고양이",
      "chien개",
      "apple사과",
      "Rose is red.A flower.",
    ]);
  });

  it("shows a private deck no one reported, read-only, and is not found for an id that is no deck's", async () => {
    await render(DeckContent, { params: Promise.resolve({ id: diary }) });
    expect(screen.getByRole("heading", { name: "Diary" })).toBeInTheDocument();
    // A private deck is not shared, so there is nothing to remove from sharing.
    expect(screen.queryByRole("button", { name: "공유에서 영구 삭제" })).not.toBeInTheDocument();

    await expect(
      render(DeckContent, { params: Promise.resolve({ id: "nope" }) }),
    ).rejects.toMatchObject(notFound);
    await expect(
      render(DeckContent, {
        params: Promise.resolve({ id: "d0000000-0000-4000-8000-0000000000ff" }),
      }),
    ).rejects.toMatchObject(notFound);
  });

  it("removes a public deck from sharing with a reason once confirmed, and then shows why", async () => {
    const user = userEvent.setup();
    const view = await render(DeckContent, { params: Promise.resolve({ id: french }) });
    await user.click(screen.getByRole("button", { name: "공유에서 영구 삭제" }));
    const confirm = screen.getByRole("button", { name: "영구 삭제" });
    expect(confirm).toBeDisabled();
    // The one action that cannot be undone confirms with a red final button, last, after 취소.
    const question = screen.getByRole("group", { name: /영구 삭제할까요/ });
    expect(
      within(question)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["취소", "영구 삭제"]);
    expect(confirm.className.split(" ")).toEqual(
      expect.arrayContaining(["bg-dont-know-text", "text-on-dont-know-text"]),
    );
    expect(confirm.className).not.toContain("bg-primary");
    await user.click(screen.getByRole("button", { name: "취소" }));
    expect(admin.removals.size).toBe(0);

    await user.click(screen.getByRole("button", { name: "공유에서 영구 삭제" }));
    await user.type(screen.getByLabelText("삭제하는 이유"), "copyright");
    await user.click(screen.getByRole("button", { name: "영구 삭제" }));
    expect(await screen.findByText("공유에서 영구 삭제했어요.")).toHaveAttribute("role", "status");
    expect(admin.removals.get(french)).toBe("copyright");
    expect(admin.decks[0]?.visibility).toBe("private");

    view.unmount();
    await render(DeckContent, { params: Promise.resolve({ id: french }) });
    expect(screen.getByRole("note")).toHaveTextContent("공유에서 영구 삭제됨 · copyright");
    expect(screen.queryByRole("button", { name: "공유에서 영구 삭제" })).not.toBeInTheDocument();
  });
});

describe("removing a deck from sharing", () => {
  it("is refused for a user who is not an admin, changing nothing, and done for an admin", async () => {
    await signIn(otherUser);
    expect(await removeDeck(french, "spam")).toEqual({
      changed: false,
      message: "관리자만 할 수 있어요.",
    });
    expect(admin.removals.size).toBe(0);
    expect(admin.decks[0]?.visibility).toBe("public");
    expect(admin.audit).toEqual([]);

    // Control: the same call by an admin removes it.
    await signIn();
    expect(await removeDeck(french, "spam")).toMatchObject({ changed: true });
  });

  it("needs a reason, and says when the deck was already removed", async () => {
    expect(await removeDeck(french, "  ")).toMatchObject({ changed: false });
    expect(admin.calls).toEqual([]);
    expect(await removeDeck(french, " spam ")).toEqual({
      changed: true,
      message: "공유에서 영구 삭제했어요.",
    });
    expect(await removeDeck(french, "spam")).toEqual({
      changed: false,
      message: "이미 공유에서 삭제된 노트예요.",
    });
    expect(admin.audit).toHaveLength(1);
  });
});

/** Adds [count] users whose emails are `user01@example.com` onward, each signed up a minute before the one before. */
function seedUsers(count: number) {
  for (let index = 1; index <= count; index++) {
    const number = String(index).padStart(2, "0");
    admin.users.push({
      id: `a0000000-0000-4000-8000-0000000000${number}`,
      email: `user${number}@example.com`,
      createdAt: new Date(Date.UTC(2026, 9, 20) - index * 60_000).toISOString(),
      lastAnswerAt: null,
      decks: 0,
      cards: 0,
      extractionsToday: 0,
    });
  }
}

/** The emails the users' table lists, in order. */
const listedEmails = () =>
  within(screen.getByRole("table", { name: "사용자 목록" }))
    .queryAllByRole("link")
    .map((link) => link.textContent);

/** The users' table's row of [email], whose cells carry more than the email, so a substring is right. */
const userRow = (email: string) => screen.getByRole("row", { name: new RegExp(email) });

describe("the users pages", () => {
  beforeEach(() => {
    testRouter.replace.mockClear();
  });

  it("lists every user as a table, newest sign-up first, with sign-up, last study, notes, cards, plan and state", async () => {
    admin.suspensions.set(otherUser.id, { reason: "spam", by: testUser.id });
    await render(UsersContent, { searchParams: Promise.resolve({}) });
    expect(
      within(screen.getByRole("table", { name: "사용자 목록" }))
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["이메일", "가입", "마지막 학습", "노트", "카드", "요금제", "상태"]);
    expect(listedEmails()).toEqual([otherUser.email, testUser.email]);
    const other = within(userRow(otherUser.email));
    expect(other.getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
      otherUser.email,
      "가입 2026-10-15",
      "마지막 학습 2026-10-18",
      "노트 2",
      "카드 3",
      "요금제 무료",
      "상태 정지됨",
    ]);
    // The admin is on 스페셜, shown like any plan, with no hidden badge (ADR 0177).
    const self = within(userRow(testUser.email));
    expect(self.getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
      testUser.email,
      "가입 2026-10-01",
      "마지막 학습 없음",
      "노트 0",
      "카드 0",
      "요금제 스페셜",
      "상태 관리자",
    ]);
    expect(screen.getByRole("navigation", { name: "사용자 페이지" })).toHaveTextContent("1–2 / 2");
  });

  it("shows 20, 50 or 100 users a page as the select above the table chooses, and pages through them", async () => {
    const user = userEvent.setup();
    seedUsers(45);
    await render(UsersContent, { searchParams: Promise.resolve({}) });
    expect(listedEmails()).toHaveLength(20);
    expect(listedEmails()[0]).toBe("user01@example.com");
    const pager = within(screen.getByRole("navigation", { name: "사용자 페이지" }));
    expect(pager.getByText("1–20 / 47")).toBeInTheDocument();
    // Below 1024 px, the page of how many in place of the rows and the page numbers.
    expect(pager.getByText("1 / 3")).toBeInTheDocument();
    expect(pager.getByRole("link", { name: "1페이지" })).toHaveAttribute("aria-current", "page");
    expect(pager.getByRole("link", { name: "3페이지" })).toHaveAttribute("href", "/users?page=3");
    expect(pager.getByRole("link", { name: "다음 페이지" })).toHaveAttribute(
      "href",
      "/users?page=2",
    );
    expect(pager.queryByRole("link", { name: "이전 페이지" })).not.toBeInTheDocument();
    // The select alone says how many a page holds.
    expect(screen.queryByText(/한 페이지/)).not.toBeInTheDocument();

    const size = screen.getByRole("combobox", { name: "몇 명씩 보기" });
    expect(size).toHaveValue("20");
    await user.selectOptions(size, "50");
    expect(testRouter.replace).toHaveBeenCalledWith("/users?size=50");

    cleanup();
    await render(UsersContent, { searchParams: Promise.resolve({ page: "3" }) });
    expect(listedEmails()).toHaveLength(7);
    expect(screen.getByText("41–47 / 47")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "다음 페이지" })).not.toBeInTheDocument();

    cleanup();
    await render(UsersContent, { searchParams: Promise.resolve({ size: "50", page: "1" }) });
    expect(listedEmails()).toHaveLength(47);
    expect(screen.getByText("1–47 / 47")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "몇 명씩 보기" })).toHaveValue("50");
  });

  it("reads the first page of 20 for an address whose page or size is not one it offers", async () => {
    seedUsers(21);
    for (const [page, size] of [
      ["x", "30"],
      ["0", "x"],
      ["-1", "200"],
      ["1.5", ""],
    ]) {
      const view = await render(UsersContent, { searchParams: Promise.resolve({ page, size }) });
      expect(listedEmails(), `${String(page)} ${String(size)}`).toHaveLength(20);
      expect(listedEmails()[0]).toBe("user01@example.com");
      view.unmount();
    }
    // Control: a page it offers reads that page.
    await render(UsersContent, { searchParams: Promise.resolve({ page: "2" }) });
    expect(listedEmails()).toEqual(["user21@example.com", otherUser.email, testUser.email]);
  });

  it("shows the last page, with its pager, for an address past the end", async () => {
    seedUsers(21);
    await render(UsersContent, { searchParams: Promise.resolve({ page: "99" }) });
    expect(listedEmails()).toEqual(["user21@example.com", otherUser.email, testUser.email]);
    const pager = within(screen.getByRole("navigation", { name: "사용자 페이지" }));
    expect(pager.getByText("21–23 / 23")).toBeInTheDocument();
    expect(pager.getByRole("link", { name: "2페이지" })).toHaveAttribute("aria-current", "page");
    expect(pager.getByRole("link", { name: "이전 페이지" })).toHaveAttribute("href", "/users");

    cleanup();
    // Control: with no user matching, there is no last page, and the list says so.
    await render(UsersContent, { searchParams: Promise.resolve({ q: "nobody", page: "99" }) });
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(
      screen.getByText("찾는 사용자가 없어요. 다른 단어나 조건으로 찾아보세요."),
    ).toBeInTheDocument();
  });

  it("searches by email as the admin types, once the typing pauses, on the list's first page", async () => {
    const user = userEvent.setup();
    await render(UsersContent, { searchParams: Promise.resolve({ q: "OTHER" }) });
    // The server reads the address's search, ignoring case.
    expect(listedEmails()).toEqual([otherUser.email]);

    const field = screen.getByRole("searchbox", { name: "이메일로 찾기" });
    expect(field).toHaveValue("OTHER");
    await user.clear(field);
    await user.type(field, "learner");
    await vi.waitFor(() => {
      expect(testRouter.replace).toHaveBeenCalledWith("/users?q=learner");
    });
    // One change of the address for the whole typed word, none for each keystroke.
    expect(testRouter.replace).toHaveBeenCalledTimes(1);
  });

  it("filters by plan and by status, each on the first page and keeping the search", async () => {
    const user = userEvent.setup();
    admin.suspensions.set(otherUser.id, { reason: "spam", by: testUser.id });
    await render(UsersContent, { searchParams: Promise.resolve({ plan: "special" }) });
    expect(listedEmails()).toEqual([testUser.email]);
    cleanup();
    await render(UsersContent, { searchParams: Promise.resolve({ status: "suspended" }) });
    expect(listedEmails()).toEqual([otherUser.email]);
    cleanup();
    // Control: a plan the list does not know filters nothing.
    await render(UsersContent, { searchParams: Promise.resolve({ plan: "gold" }) });
    expect(listedEmails()).toEqual([otherUser.email, testUser.email]);

    cleanup();
    await render(UsersContent, {
      searchParams: Promise.resolve({ q: "example", status: "active", page: "2" }),
    });
    await user.selectOptions(screen.getByRole("combobox", { name: "요금제" }), "pro");
    expect(testRouter.replace).toHaveBeenLastCalledWith("/users?q=example&plan=pro&status=active");
    // A second change before the server draws the first builds on the first.
    await user.selectOptions(screen.getByRole("combobox", { name: "상태" }), "");
    expect(testRouter.replace).toHaveBeenLastCalledWith("/users?q=example&plan=pro");
  });

  it("says when nothing matches the search and the filters", async () => {
    await render(UsersContent, { searchParams: Promise.resolve({ q: "nobody" }) });
    expect(
      screen.getByText("찾는 사용자가 없어요. 다른 단어나 조건으로 찾아보세요."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("opens a user's details beside the list from its row, with a quiet icon back to the list and none to its page", async () => {
    await render(UsersContent, { searchParams: Promise.resolve({ status: "active" }) });
    expect(screen.getByRole("link", { name: otherUser.email })).toHaveAttribute(
      "href",
      `/users?status=active&user=${otherUser.id}`,
    );
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();

    cleanup();
    await render(UsersContent, {
      searchParams: Promise.resolve({ status: "active", user: otherUser.id }),
    });
    expect(screen.getByRole("link", { name: otherUser.email })).toHaveAttribute(
      "aria-current",
      "true",
    );
    // Beside the details, the table leaves out what they hold.
    expect(
      within(screen.getByRole("table", { name: "사용자 목록" }))
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["이메일", "가입", "요금제", "상태"]);
    const panel = within(screen.getByRole("complementary", { name: otherUser.email }));
    expect(panel.getByRole("heading", { level: 2, name: otherUser.email })).toBeInTheDocument();
    expect(panel.getByText("노트 · 카드").nextSibling).toHaveTextContent("2개 · 3장");
    expect(panel.getByRole("link", { name: "닫기" })).toHaveAttribute(
      "href",
      "/users?status=active",
    );
    expect(panel.queryByRole("link", { name: "크게 보기" })).not.toBeInTheDocument();
    expect(panel.getByRole("heading", { level: 2, name: otherUser.email })).toHaveClass(
      "text-body-strong",
    );
    // Under the email, one line: the plan and the sign-up day.
    expect(panel.getByText(/^가입 \d{4}-\d{2}-\d{2}$/)).toBeInTheDocument();
    // 요금제 바꾸기 is a row at the end of the plan's group; there is no row of buttons.
    expect(
      within(panel.getByRole("region", { name: "요금제" }))
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["요금제 바꾸기"]);
    expect(panel.queryByRole("region", { name: "작업" })).not.toBeInTheDocument();
    // Suspension is the last section, its explanation under its action.
    const last = panel.getAllByRole("region").at(-1) as HTMLElement;
    expect(last).toHaveAccessibleName("계정 정지");
    const stop = within(last).getByRole("button", { name: "이용 정지" });
    expect(stop).toHaveClass("text-dont-know-text");
    const why = within(last).getByText(
      "이용 정지하면 로그인, 사진으로 카드 만들기, 동기화가 막혀요. 데이터는 그대로 남아요.",
    );
    expect(stop.compareDocumentPosition(why) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // No raised button: no control on the surface or the primary fill.
    for (const control of [...panel.getAllByRole("button"), ...panel.getAllByRole("link")]) {
      expect(control.className, control.textContent).not.toMatch(/\bbg-(surface|primary)\b/);
    }
    // Below 1024 px the details take the list's place, as a page would.
    expect(
      screen.getByRole("table", { name: "사용자 목록" }).closest(".max-lg\\:hidden"),
    ).not.toBeNull();

    cleanup();
    // Control: an address naming no user's id shows the list alone.
    await render(UsersContent, { searchParams: Promise.resolve({ user: "not-a-uuid" }) });
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(listedEmails()).toEqual([otherUser.email, testUser.email]);
  });

  it("opens one user's own page, read-only, with the period's photos against the plan's limit", async () => {
    await render(UserContent, { params: Promise.resolve({ id: otherUser.id }) });
    expect(
      screen.getByRole("heading", { level: 1, name: "other@example.com" }),
    ).toBeInTheDocument();
    const account = within(screen.getByRole("region", { name: "계정" }));
    expect(account.getByText("이번 달 사진 추출").nextSibling).toHaveTextContent(
      "4장 / 한 달 10장",
    );
    expect(account.getByText("마지막 학습").nextSibling).toHaveTextContent("2026-10-18 09:30");
    expect(account.getByText("노트 · 카드").nextSibling).toHaveTextContent("2개 · 3장");
    expect(screen.queryByRole("link", { name: "목록으로" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /삭제|편집/ })).not.toBeInTheDocument();
  });

  it("lists the user's notes, public and private, each linked, a public one with its reports", async () => {
    await render(UserContent, { params: Promise.resolve({ id: otherUser.id }) });
    const decks = within(screen.getByRole("region", { name: "노트" }));
    // Each row carries the name, its chips and its cards, so a substring is right.
    expect(decks.getByRole("link", { name: /^French공개신고 2/ })).toHaveAttribute(
      "href",
      `/decks/${french}`,
    );
    expect(decks.getByRole("link", { name: /^Diary비공개카드/ })).toHaveAttribute(
      "href",
      `/decks/${diary}`,
    );
  });

  it("shows the plan's next renewal, the 1st in Seoul, and opens the grant form in a sheet from 요금제 바꾸기", async () => {
    const user = userEvent.setup();
    await render(UserContent, { params: Promise.resolve({ id: otherUser.id }) });
    const plan = within(screen.getByRole("region", { name: "요금제" }));
    const [year = 0, month = 0] = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" })
      .format(Date.now())
      .split("-")
      .map(Number);
    const renewal =
      month === 12
        ? `${String(year + 1)}-01-01`
        : `${String(year)}-${String(month + 1).padStart(2, "0")}-01`;
    expect(plan.getByText("다음 갱신").nextSibling).toHaveTextContent(renewal);
    expect(screen.queryByRole("form", { name: "요금제 지정" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "요금제 바꾸기" }));
    const sheet = within(screen.getByRole("dialog", { name: "요금제 바꾸기" }));
    expect(sheet.getByRole("form", { name: "요금제 지정" })).toBeInTheDocument();
    // The sheet's one primary, last.
    expect(sheet.getAllByRole("button").at(-1)).toHaveTextContent("지정");
    expect(sheet.getByRole("button", { name: "지정" }).className).toContain("bg-primary");
  });

  it("lists every live deck of a user, private ones too, each opening the deck", async () => {
    await render(UserContent, { params: Promise.resolve({ id: otherUser.id }) });
    const decks = within(screen.getByRole("region", { name: "노트" }));
    expect(decks.getByRole("link", { name: /Diary/ })).toHaveAttribute("href", `/decks/${diary}`);
    expect(decks.getByRole("link", { name: /French/ })).toHaveTextContent("카드 2장");
  });
});

describe("a user's suspension", () => {
  it("suspends a user with a reason once confirmed, shows it, and lifts it", async () => {
    const user = userEvent.setup();
    await render(UserContent, { params: Promise.resolve({ id: otherUser.id }) });
    const section = within(screen.getByRole("region", { name: "계정 정지" }));
    await user.click(section.getByRole("button", { name: "이용 정지" }));
    // It asks in the shared sheet, for a reason first.
    const confirm = within(
      screen.getByRole("dialog", { name: "other@example.com의 이용을 정지할까요?" }),
    );
    expect(confirm.getByRole("button", { name: "정지" })).toBeDisabled();
    await user.type(confirm.getByLabelText("정지하는 이유"), "spam decks");
    await user.click(confirm.getByRole("button", { name: "정지" }));
    expect(await section.findByRole("status")).toHaveTextContent("이용을 정지했어요.");
    expect(admin.suspensions.get(otherUser.id)).toEqual({ reason: "spam decks", by: testUser.id });

    await render(UserContent, { params: Promise.resolve({ id: otherUser.id }) });
    expect(screen.getByText("정지됨 · spam decks")).toBeInTheDocument();
    await render(UsersContent, { searchParams: Promise.resolve({ q: "other" }) });
    // The row carries every cell, so a substring is right.
    expect(screen.getByRole("row", { name: /other@example.com/ })).toHaveTextContent("정지됨");

    expect(await unsuspendUser(otherUser.id)).toEqual({
      changed: true,
      message: "정지를 풀었어요.",
    });
    expect(await unsuspendUser(otherUser.id)).toEqual({
      changed: false,
      message: "정지된 사용자가 아니에요.",
    });
    expect(admin.suspensions.size).toBe(0);
  });

  it("refuses one's own account, a second suspension and a missing reason", async () => {
    expect(await suspendUser(otherUser.id, "")).toMatchObject({ changed: false });
    expect(admin.calls).toEqual([]);
    expect(await suspendUser(testUser.id, "test")).toEqual({
      changed: false,
      message: "내 계정은 정지할 수 없어요.",
    });
    expect(await suspendUser(otherUser.id, "spam")).toMatchObject({ changed: true });
    expect(await suspendUser(otherUser.id, "spam")).toEqual({
      changed: false,
      message: "이미 정지된 사용자예요.",
    });
    expect(admin.audit.map((entry) => entry.action)).toEqual(["suspend_user"]);
  });

  it("is refused to a user who is not an admin, changing nothing, and done for an admin", async () => {
    await signIn(otherUser);
    expect(await suspendUser(testUser.id, "spam")).toEqual({
      changed: false,
      message: "관리자만 할 수 있어요.",
    });
    admin.suspensions.set(testUser.id, { reason: "seeded", by: otherUser.id });
    expect(await unsuspendUser(testUser.id)).toEqual({
      changed: false,
      message: "관리자만 할 수 있어요.",
    });
    expect(admin.suspensions.get(testUser.id)?.reason).toBe("seeded");
    expect(admin.audit).toEqual([]);

    // Control: the same calls by an admin, on a user who is not the caller.
    await signIn();
    expect(await suspendUser(otherUser.id, "spam")).toMatchObject({ changed: true });
    expect(await unsuspendUser(otherUser.id)).toMatchObject({ changed: true });
  });
});

describe("the admins page", () => {
  it("lists the admins and offers no revoke of one's own role", async () => {
    admin.admins.set(otherUser.id, { grantedAt: "2026-10-19T02:00:00Z", grantedBy: testUser.id });
    await render(AdminsContent, {});
    const rows = within(screen.getByRole("region", { name: "지정된 관리자" })).getAllByRole(
      "listitem",
    );
    expect(rows.map((row) => row.querySelector("span span")?.textContent)).toEqual([
      "learner@example.com (나)",
      "other@example.com",
    ]);
    expect(within(rows[0] as HTMLElement).queryByRole("button", { name: "해제" })).toBeNull();
    expect(
      within(rows[1] as HTMLElement).getByRole("button", { name: "해제" }),
    ).toBeInTheDocument();
  });

  it("grants the role by an existing user's email, and refuses an unknown one", async () => {
    const form = (email: string) => {
      const data = new FormData();
      data.set("email", email);
      return data;
    };
    expect(await grantAdmin({ message: null }, form("nobody@example.com"))).toEqual({
      message: "이 이메일로 가입한 사용자가 없어요.",
    });
    expect(await grantAdmin({ message: null }, form(" Other@Example.com "))).toEqual({
      message: "Other@Example.com님을 관리자로 지정했어요.",
    });
    expect(admin.admins.has(otherUser.id)).toBe(true);
    expect(await grantAdmin({ message: null }, form("other@example.com"))).toEqual({
      message: "이미 관리자예요.",
    });
    expect(admin.audit).toMatchObject([{ action: "grant_admin", target_id: otherUser.id }]);
  });

  it("revokes another admin, refuses one's own role, and refuses a user who is not an admin", async () => {
    admin.admins.set(otherUser.id, { grantedAt: "2026-10-19T02:00:00Z", grantedBy: testUser.id });
    expect(await revokeAdmin(testUser.id)).toEqual({
      changed: false,
      message: "내 관리자 권한은 해제할 수 없어요.",
    });
    expect(await revokeAdmin(otherUser.id)).toEqual({
      changed: true,
      message: "관리자에서 해제했어요.",
    });
    expect(admin.admins.has(otherUser.id)).toBe(false);

    await signIn(otherUser);
    expect(await revokeAdmin(testUser.id)).toEqual({
      changed: false,
      message: "관리자만 할 수 있어요.",
    });
    expect(admin.admins.has(testUser.id)).toBe(true);
  });
});

/** The first line of each entry of the audit log's list. */
const auditEntries = () =>
  within(screen.getByRole("list", { name: "작업 기록" }))
    .getAllByRole("listitem")
    .map((entry) => entry.firstChild?.textContent);

describe("the audit log", () => {
  it("shows each write, newest first, with who acted and on what", async () => {
    await hideDeck(french);
    const data = new FormData();
    data.set("email", "other@example.com");
    await grantAdmin({ message: null }, data);
    await render(AdminsContent, {});
    expect(auditEntries()).toEqual(["관리자 지정 · other@example.com", "노트 숨기기 · French"]);
    expect(screen.getByRole("link", { name: "French" })).toHaveAttribute(
      "href",
      `/decks/${french}`,
    );
  });

  it("names a suspension and a removal from sharing, with each one's reason", async () => {
    await suspendUser(otherUser.id, "spam decks");
    await unsuspendUser(otherUser.id);
    await removeDeck(french, "copyright");
    await render(AdminsContent, {});
    expect(auditEntries()).toEqual([
      "공유에서 영구 삭제 · French · copyright",
      "정지 해제 · other@example.com",
      "이용 정지 · other@example.com · spam decks",
    ]);
  });

  it("is refused to a user who is not an admin", async () => {
    await signIn(otherUser);
    await render(AdminsContent, {});
    const log = within(screen.getByRole("region", { name: "작업 기록" }));
    expect(log.getByRole("alert")).toHaveTextContent("관리자만 볼 수 있어요.");
    expect(log.queryByRole("list", { name: "작업 기록" })).not.toBeInTheDocument();
  });
});

/** A form of [fields], as the browser posts it. */
function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

describe("the plans page", () => {
  it("shows the terms each plan's new subscribers take, and opens a plan's versions and its form for a new one in a sheet, the model changed in AI", async () => {
    const user = userEvent.setup();
    admin.planVersions.push({
      id: 7,
      plan: "pro",
      quota: "daily",
      amount: 100,
      starts_at: "2026-10-26T00:00:01Z",
      applies_to_all: false,
      created_by: testUser.id,
    });
    admin.aiConfigurations[1] = {
      ...admin.aiConfigurations[1]!,
      provider: "anthropic",
      model: "claude-sonnet-5",
    };
    await render(PlansContent, { searchParams: Promise.resolve({}) });
    const table = within(screen.getByRole("table", { name: "요금제 목록" }));
    expect(table.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "요금제",
      "사진 한도",
      "AI 구성",
      "가입자",
      "작업",
    ]);
    expect(
      table
        .getAllByRole("row")
        .slice(1)
        .map((row) =>
          within(row)
            .getAllByRole("cell")
            .map((cell) => cell.textContent),
        ),
    ).toEqual([
      [
        "무료",
        "사진 한도 한 달 10장",
        "AI 구성 OpenRouter · anthropic/claude-haiku-5.5 AI에서 보기",
        "가입자 1명",
        "한도 바꾸기",
      ],
      [
        "플러스",
        "사진 한도 하루 100장",
        "AI 구성 Anthropic · claude-sonnet-5 AI에서 보기",
        "가입자 0명",
        "한도 바꾸기",
      ],
      [
        "프로",
        "사진 한도 무제한 (하루 1000장까지)",
        "AI 구성 OpenRouter · anthropic/claude-haiku-5.5 AI에서 보기",
        "가입자 0명",
        "한도 바꾸기",
      ],
      [
        "스페셜",
        "사진 한도 제한 없음",
        "AI 구성 OpenRouter · anthropic/claude-haiku-5.5 AI에서 보기",
        "가입자 1명",
        "",
      ],
    ]);
    // The AI configuration is shown here and changed in AI.
    expect(
      table.getAllByRole("link", { name: "AI에서 보기" }).map((link) => link.getAttribute("href")),
    ).toEqual(["/ai?plan=free", "/ai?plan=pro", "/ai?plan=max", "/ai?plan=special"]);
    // Nothing but the table is open until a plan's 한도 바꾸기 is pressed.
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const open = async (name: string) => {
      await user.click(
        within(screen.getByRole("row", { name: new RegExp(`^${name}`) })).getByRole("button", {
          name: "한도 바꾸기",
        }),
      );
      return within(screen.getByRole("dialog", { name: `${name} 한도 바꾸기` }));
    };
    const free = await open("무료");
    expect(free.getAllByRole("button").at(-1)).toHaveTextContent("만들기");
    expect(free.getByRole("combobox", { name: "한도" })).toHaveValue("monthly");
    expect(free.getByRole("spinbutton", { name: "사진 장 수" })).toHaveValue(10);
    expect(free.queryByRole("textbox", { name: "모델" })).not.toBeInTheDocument();
    expect(
      within(free.getByRole("list", { name: "무료 버전" }))
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toEqual([
      "한 달 10장 · 지금 가입 시 적용2026-10-26 00:00부터 · 기존 사용자는 갱신일부터",
      "하루 30장2026-10-19 00:00부터 · 기존 사용자는 갱신일부터",
    ]);
    await user.click(free.getByRole("button", { name: "닫기" }));
    const pro = await open("플러스");
    // The row carries its start and author after its terms, so a substring is right.
    expect(pro.getByText(/learner@example.com/)).toBeInTheDocument();
    await user.click(pro.getByRole("button", { name: "닫기" }));
    const max = await open("프로");
    expect(max.getByText(/기존 사용자도 적용/)).toBeInTheDocument();
  });

  it("creates a version from now, records it, and says when the terms are the current ones", async () => {
    const create = () =>
      createPlanVersion({ message: null }, form({ plan: "pro", quota: "daily", amount: "200" }));
    expect(await create()).toEqual({ message: "새 버전을 만들었어요." });
    expect(admin.planVersions.at(-1)).toMatchObject({
      plan: "pro",
      quota: "daily",
      amount: 200,
      applies_to_all: false,
    });
    expect(admin.audit).toMatchObject([
      { action: "create_plan_version", target_kind: "plan", target_id: "pro" },
    ]);
    expect(revalidated).toEqual(["/admin"]);
    expect(await create()).toEqual({ message: "지금 버전과 같아요." });
  });

  it("starts a version at 00:00 in Seoul on the day chosen, refuses a day already past, and applies one to existing users only in their favour", async () => {
    const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const create = (fields: Record<string, string>) =>
      createPlanVersion({ message: null }, form(fields));
    expect(await create({ plan: "free", quota: "monthly", amount: "20", starts_on: day })).toEqual({
      message: "새 버전을 만들었어요.",
    });
    expect(admin.planVersions.at(-1)?.starts_at).toBe(
      new Date(`${day}T00:00:00+09:00`).toISOString(),
    );
    expect(
      await create({ plan: "free", quota: "monthly", amount: "30", starts_on: "2020-01-01" }),
    ).toEqual({ message: "시작일은 내일 이후로 정하거나, 지금부터면 비워 두세요." });
    const unfavoured = {
      message: "기존 사용자에게 바로 적용할 수 있는 건 사진을 줄이지 않는 변경뿐이에요.",
    };
    expect(
      await create({ plan: "max", quota: "unlimited", amount: "500", applies_to_all: "on" }),
    ).toEqual(unfavoured);
    expect(
      await create({ plan: "max", quota: "daily", amount: "2000", applies_to_all: "on" }),
    ).toEqual(unfavoured);
    expect(
      await create({ plan: "max", quota: "unlimited", amount: "2000", applies_to_all: "on" }),
    ).toEqual({ message: "새 버전을 만들었어요." });
    expect(admin.planVersions.at(-1)).toMatchObject({ plan: "max", applies_to_all: true });
    expect(admin.audit).toHaveLength(2);
  });

  it("cannot save a malformed amount, asking the server nothing", async () => {
    const versions = admin.planVersions.length;
    expect(
      await createPlanVersion(
        { message: null },
        form({ plan: "free", quota: "daily", amount: "100001" }),
      ),
    ).toEqual({ message: "사진 장 수는 0에서 100000 사이의 정수로 적어 주세요." });
    expect(admin.planVersions).toHaveLength(versions);
    expect(admin.calls.some((call) => call.startsWith("admin_create_plan_version"))).toBe(false);
    expect(
      await createPlanVersion(
        { message: null },
        form({ plan: "free", quota: "daily", amount: "5" }),
      ),
    ).toEqual({ message: "새 버전을 만들었어요." });
    expect(admin.planVersions, "control: a whole number is saved").toHaveLength(versions + 1);
  });

  it("refuses a user who is not an admin, and changes nothing", async () => {
    const versions = admin.planVersions.length;
    await signIn(otherUser);
    expect(
      await createPlanVersion(
        { message: null },
        form({ plan: "free", quota: "daily", amount: "5" }),
      ),
    ).toEqual({ message: "관리자만 할 수 있어요." });
    expect(admin.planVersions).toHaveLength(versions);
    await render(PlansContent, { searchParams: Promise.resolve({}) });
    expect(screen.getByRole("alert")).toHaveTextContent("관리자만 볼 수 있어요.");
  });

  it("costs a photo without a call record at the model serving Free now, and leaves out one a never-measured model served", async () => {
    const free = admin.aiConfigurations.find((entry) => entry.plan === "free");
    if (free) free.model = "openai/gpt-6-luna";
    admin.breakdown = [
      { day: utcDay(), plan: null, model: null, prompt_version_id: null, photos: 4 },
      {
        day: utcDay(),
        plan: "pro",
        model: "anthropic/claude-haiku-5.5",
        prompt_version_id: 1,
        photos: 1,
      },
    ];
    await render(TodoContent, {});
    const week = within(screen.getByRole("region", { name: "이번 주" }));
    expect(week.getByText("읽은 사진 · 예상 비용").closest("div")).toHaveTextContent(
      /5장 · \$0\.0018/,
    );
    expect(
      screen.getByText(/측정하지 않은 모델\(openai\/gpt-6-luna\)의 사진은 비용에서 빠졌어요/),
    ).toBeInTheDocument();
  });
});

describe("스페셜", () => {
  it("shows an admin on 스페셜 with no limit, like any plan, with no 무제한 section", async () => {
    await render(UserContent, { params: Promise.resolve({ id: testUser.id }) });
    const plan = within(screen.getByRole("region", { name: "요금제" }));
    expect(plan.getByText("지금").nextSibling).toHaveTextContent("스페셜 · 제한 없음");
    // The header and the 계정 group carry several facts each, so a substring is right.
    const header = screen.getByRole("heading", { level: 1 }).parentElement;
    expect(header).toHaveTextContent("스페셜");
    expect(header).not.toHaveTextContent(/무제한|숨김/);
    expect(screen.queryByRole("region", { name: "무제한" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "계정" })).toHaveTextContent("0장 / 제한 없음");

    await render(UserContent, { params: Promise.resolve({ id: otherUser.id }) });
    const other = within(screen.getAllByRole("region", { name: "요금제" }).at(-1) as HTMLElement);
    expect(
      other.getByText("지금").nextSibling,
      "control: a user who is not an admin is on its plan",
    ).toHaveTextContent("무료 · 한 달 10장");
  });

  it("is offered in 요금제 바꾸기, given until a day's end, logged, and taken back to Free", async () => {
    const user = userEvent.setup();
    await render(UserContent, { params: Promise.resolve({ id: otherUser.id }) });
    await user.click(screen.getByRole("button", { name: "요금제 바꾸기" }));
    const choices = within(
      within(screen.getByRole("dialog", { name: "요금제 바꾸기" })).getByRole("combobox", {
        name: "바꿀 요금제",
      }),
    );
    expect(choices.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "플러스",
      "프로",
      "스페셜",
    ]);

    const ends = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    expect(
      await grantPlan(
        { message: null },
        form({ user: otherUser.id, plan: "special", ends_on: ends }),
      ),
    ).toEqual({ message: "스페셜로 지정했어요." });
    const next = new Date(Date.parse(`${ends}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    expect(admin.userPlans.get(otherUser.id)).toEqual({
      plan: "special",
      endsAt: `${next}T04:00:00.000Z`,
      grantedBy: testUser.id,
    });

    await render(UserContent, { params: Promise.resolve({ id: otherUser.id }) });
    const granted = within(screen.getAllByRole("region", { name: "요금제" }).at(-1) as HTMLElement);
    expect(granted.getByText("지금").nextSibling).toHaveTextContent("스페셜 · 제한 없음");
    expect(granted.getByText("스페셜 지정", { selector: "dt" }).nextSibling).toHaveTextContent(
      testUser.email,
    );
    expect(granted.getByText("지정한 곳", { selector: "dt" }).nextSibling).toHaveTextContent(
      "관리자",
    );
    expect(granted.getByText("마지막 날", { selector: "dt" }).nextSibling).toHaveTextContent(ends);
    const account = within(screen.getAllByRole("region", { name: "계정" }).at(-1) as HTMLElement);
    expect(account.getByText("오늘 사진 추출").nextSibling).toHaveTextContent("4장 / 제한 없음");

    expect(await revokePlan(otherUser.id)).toEqual({
      changed: true,
      message: "무료로 되돌렸어요.",
    });
    await render(AdminsContent, {});
    expect(auditEntries()).toEqual([
      "무료로 되돌리기 · other@example.com · 스페셜",
      "요금제 지정 · other@example.com · 스페셜",
    ]);
  });

  it("shows an ended 스페셜 as ended, with the user on Free", async () => {
    admin.userPlans.set(otherUser.id, {
      plan: "special",
      endsAt: new Date(Date.now() - 86_400_000).toISOString(),
      grantedBy: testUser.id,
    });
    await render(UserContent, { params: Promise.resolve({ id: otherUser.id }) });
    const plan = within(screen.getByRole("region", { name: "요금제" }));
    expect(plan.getByText("지금").nextSibling).toHaveTextContent("무료 · 한 달 10장");
    expect(plan.getByText("끝난 날", { selector: "dt" })).toBeInTheDocument();
  });

  it("names no grant's source for a user with no grant", async () => {
    await render(UserContent, { params: Promise.resolve({ id: otherUser.id }) });
    const plan = within(screen.getByRole("region", { name: "요금제" }));
    expect(plan.getByText("지금")).toBeInTheDocument();
    expect(plan.queryByText("지정한 곳")).not.toBeInTheDocument();
  });

  describe("a user's plan source", () => {
    const day = 86_400_000;
    const planGroup = () => within(screen.getByRole("region", { name: "요금제" }));
    const storeEnd = () => new Date(Date.now() + 20 * day).toISOString();

    it("names a store grant that renews, with its renewal day", async () => {
      const endsAt = storeEnd();
      admin.storeGrants.set(otherUser.id, { plan: "pro", endsAt, renews: true });
      await render(UserContent, { params: Promise.resolve({ id: otherUser.id }) });
      const plan = planGroup();
      expect(plan.getByText("지금").nextSibling).toHaveTextContent("플러스");
      expect(plan.getByText("지정한 곳", { selector: "dt" }).nextSibling).toHaveTextContent(
        "스토어 구독",
      );
      expect(plan.getByText("구독 갱신", { selector: "dt" }).nextSibling).toHaveTextContent(
        endsAt.slice(0, 10),
      );
      // Control: a renewing grant is not shown as ending, and no admin grant row stands.
      expect(plan.queryByText("구독 끝")).toBeNull();
      expect(plan.queryByText("플러스 지정")).toBeNull();
    });

    it("names a store grant that ends, with its last day", async () => {
      const endsAt = storeEnd();
      admin.storeGrants.set(otherUser.id, { plan: "max", endsAt, renews: false });
      await render(UserContent, { params: Promise.resolve({ id: otherUser.id }) });
      const plan = planGroup();
      expect(plan.getByText("지금").nextSibling).toHaveTextContent("프로");
      expect(plan.getByText("구독 끝", { selector: "dt" }).nextSibling).toHaveTextContent(
        endsAt.slice(0, 10),
      );
      expect(plan.queryByText("구독 갱신")).toBeNull();
    });

    it("names an admin's grant as 관리자 and shows no store row", async () => {
      admin.userPlans.set(otherUser.id, { plan: "pro", endsAt: null, grantedBy: testUser.id });
      await render(UserContent, { params: Promise.resolve({ id: otherUser.id }) });
      const plan = planGroup();
      expect(plan.getByText("지정한 곳", { selector: "dt" }).nextSibling).toHaveTextContent(
        "관리자",
      );
      expect(plan.queryByText("스토어 구독")).toBeNull();
      expect(plan.queryByText("구독 갱신")).toBeNull();
      expect(plan.queryByText("구독 끝")).toBeNull();
    });

    it("names an unlimited grant as 관리자, and the better of an admin and a store grant wins", async () => {
      admin.userPlans.set(otherUser.id, { plan: "special", endsAt: null, grantedBy: testUser.id });
      admin.storeGrants.set(otherUser.id, { plan: "pro", endsAt: storeEnd(), renews: true });
      await render(UserContent, { params: Promise.resolve({ id: otherUser.id }) });
      expect(planGroup().getByText("지정한 곳", { selector: "dt" }).nextSibling).toHaveTextContent(
        "관리자",
      );
      expect(planGroup().queryByText("스토어 구독")).toBeNull();
      cleanup();
      admin.userPlans.set(otherUser.id, { plan: "pro", endsAt: null, grantedBy: testUser.id });
      admin.storeGrants.set(otherUser.id, { plan: "max", endsAt: storeEnd(), renews: true });
      await render(UserContent, { params: Promise.resolve({ id: otherUser.id }) });
      expect(planGroup().getByText("지정한 곳", { selector: "dt" }).nextSibling).toHaveTextContent(
        "스토어 구독",
      );
    });

    it("counts a store plan in the plan filter, against a user with no grant", async () => {
      await render(UsersContent, { searchParams: Promise.resolve({ plan: "pro" }) });
      expect(screen.queryByRole("table", { name: "사용자 목록" })).toBeNull();
      cleanup();
      admin.storeGrants.set(otherUser.id, { plan: "pro", endsAt: storeEnd(), renews: true });
      await render(UsersContent, { searchParams: Promise.resolve({ plan: "pro" }) });
      expect(listedEmails()).toEqual([otherUser.email]);
    });

    it("refuses a malformed source or store date, against the well-formed row", async () => {
      const row = {
        plan: null,
        version_id: null,
        quota: null,
        amount: null,
        provider: null,
        model: null,
        used: null,
        granted_plan: null,
        ends_at: null,
        granted_at: null,
        granted_by_email: null,
        source: "none",
        store_ends_at: null,
        store_renews: null,
      };
      const answer = async (value: Record<string, unknown>) => {
        server.use(
          http.post(`${supabaseUrl}/rest/v1/rpc/admin_user_plan`, () =>
            HttpResponse.json([{ ...row, ...value }]),
          ),
        );
        return await readUser(otherUser.id);
      };
      const store = { source: "store", store_ends_at: storeEnd(), store_renews: true };
      expect(await answer({})).toMatchObject({ data: { plan: { source: "none", store: null } } });
      expect(await answer(store)).toMatchObject({
        data: { plan: { source: "store", store: { renews: true } } },
      });
      expect(await answer({ source: "gift" })).toEqual({ failure: "unreadable" });
      expect(await answer({ source: undefined })).toEqual({ failure: "unreadable" });
      expect(await answer({ ...store, store_ends_at: "soon" })).toEqual({ failure: "unreadable" });
      expect(await answer({ ...store, store_renews: "yes" })).toEqual({ failure: "unreadable" });
      expect(await answer({ source: "admin", store_renews: true })).toEqual({
        failure: "unreadable",
      });
    });
  });

  it("lists 스페셜 on the plans page with no limit and no form for a new version", async () => {
    await render(PlansContent, { searchParams: Promise.resolve({}) });
    const special = screen.getByRole("row", { name: /^스페셜/ });
    // The row carries every cell, so a substring is right.
    expect(special).toHaveTextContent("사진 한도 제한 없음");
    expect(special).not.toHaveTextContent("숨김");
    expect(within(special).queryByRole("button")).not.toBeInTheDocument();
    const max = within(screen.getByRole("row", { name: /^프로/ }));
    expect(
      max.getByRole("button", { name: "한도 바꾸기" }),
      "control: Max has its form",
    ).toBeInTheDocument();
  });
});

describe("a user's plan", () => {
  it("shows Free with its terms, grants Max until a day's end in the admin's zone, and goes back to Free", async () => {
    await render(UserContent, { params: Promise.resolve({ id: otherUser.id }) });
    const plan = within(screen.getByRole("region", { name: "요금제" }));
    expect(plan.getByText("지금").nextSibling).toHaveTextContent("무료 · 한 달 10장");
    expect(plan.getByText("모델").nextSibling).toHaveTextContent("anthropic/claude-haiku-5.5");
    expect(plan.queryByRole("button", { name: "무료로 되돌리기" })).not.toBeInTheDocument();

    const ends = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    expect(
      await grantPlan({ message: null }, form({ user: otherUser.id, plan: "max", ends_on: ends })),
    ).toEqual({ message: "프로로 지정했어요." });
    // The last day ends at the next study day's start, 04:00 in the admin's zone, UTC here.
    const next = new Date(Date.parse(`${ends}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    expect(admin.userPlans.get(otherUser.id)).toEqual({
      plan: "max",
      endsAt: `${next}T04:00:00.000Z`,
      grantedBy: testUser.id,
    });
    expect(admin.audit).toMatchObject([{ action: "grant_plan", target_id: otherUser.id }]);

    await render(UserContent, { params: Promise.resolve({ id: otherUser.id }) });
    const granted = within(screen.getAllByRole("region", { name: "요금제" }).at(-1) as HTMLElement);
    expect(granted.getByText("지금").nextSibling).toHaveTextContent(
      "프로 · 무제한 (하루 1000장까지)",
    );
    expect(granted.getByText("마지막 날", { selector: "dt" }).nextSibling).toHaveTextContent(ends);
    // A row at the end of the plan's group while the grant stands.
    expect(granted.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "요금제 바꾸기",
      "무료로 되돌리기",
    ]);

    expect(await revokePlan(otherUser.id)).toEqual({
      changed: true,
      message: "무료로 되돌렸어요.",
    });
    expect(await revokePlan(otherUser.id)).toEqual({ changed: false, message: "이미 무료예요." });
    expect(admin.userPlans.has(otherUser.id)).toBe(false);
  });

  it("refuses an end on Pro and an end already past, and refuses a user who is not an admin", async () => {
    expect(
      await grantPlan(
        { message: null },
        form({ user: otherUser.id, plan: "pro", ends_on: "2030-01-01" }),
      ),
    ).toEqual({ message: "끝나는 날은 프로와 스페셜에만 정할 수 있어요." });
    expect(
      await grantPlan(
        { message: null },
        form({ user: otherUser.id, plan: "max", ends_on: "2020-01-01" }),
      ),
    ).toEqual({ message: "끝나는 날은 오늘 이후로 정해 주세요." });
    expect(
      await grantPlan({ message: null }, form({ user: otherUser.id, plan: "gold", ends_on: "" })),
    ).toEqual({ message: "하지 못했어요. 잠시 후 다시 시도해 주세요." });
    expect(
      await grantPlan({ message: null }, form({ user: otherUser.id, plan: "pro", ends_on: "" })),
    ).toEqual({ message: "플러스로 지정했어요." });

    await signIn(otherUser);
    expect(
      await grantPlan({ message: null }, form({ user: otherUser.id, plan: "max", ends_on: "" })),
    ).toEqual({ message: "관리자만 할 수 있어요." });
    expect(await revokePlan(otherUser.id)).toEqual({
      changed: false,
      message: "관리자만 할 수 있어요.",
    });
    expect(admin.userPlans.get(otherUser.id)?.plan).toBe("pro");
  });

  it("names each plan change in the audit log", async () => {
    await createPlanVersion(
      { message: null },
      form({
        plan: "pro",
        quota: "daily",
        amount: "200",
        applies_to_all: "",
      }),
    );
    await grantPlan({ message: null }, form({ user: otherUser.id, plan: "pro", ends_on: "" }));
    await render(AdminsContent, {});
    expect(auditEntries()).toEqual([
      "요금제 지정 · other@example.com · 플러스",
      "요금제 새 버전 · 플러스 · 하루 200장",
    ]);
    expect(screen.getByRole("link", { name: "플러스" })).toHaveAttribute("href", "/plans");
  });
});
