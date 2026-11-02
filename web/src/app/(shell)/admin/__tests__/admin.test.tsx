import { screen, within } from "@testing-library/react";
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
import { studyDayStart } from "@/features/study";
import { FakeAdmin } from "@/testing/mocks/admin";
import { otherUser, testUser } from "@/testing/mocks/handlers";
import { server } from "@/testing/mocks/server";
import { setRequestCookies } from "@/testing/next-headers";
import { render } from "@/testing/render";
import { signedInCookies } from "@/testing/session";

import { AdminGate } from "../_components/admin-gate";
import {
  AdminsContent,
  AuditContent,
  DeckContent,
  OverviewContent,
  PlansContent,
  PublicDecksContent,
  ReportsContent,
  UserContent,
  UsersContent,
} from "../_components/content";

vi.mock("next/headers", () => import("@/testing/next-headers"));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => "/admin/reports",
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

/** Signs the next request in as [user], with the browser's zone UTC. */
async function signIn(user: typeof testUser | typeof otherUser = testUser) {
  setRequestCookies([...(await signedInCookies(user)), { name: "smartman-tz", value: "UTC" }]);
}

let admin: FakeAdmin;
beforeEach(async () => {
  revalidated.length = 0;
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
  it("gives a user who is not an admin the not-found page, and an admin the area's menu", async () => {
    await signIn(otherUser);
    await expect(render(AdminGate, { children: <p>내용</p> })).rejects.toMatchObject(notFound);
    expect(admin.calls.map((call) => call.split(" ")[0])).toEqual(["is_admin"]);

    // Control: the admin sees the menu and the page.
    await signIn();
    await render(AdminGate, { children: <p>내용</p> });
    const menu = screen.getByRole("navigation", { name: "관리 메뉴" });
    expect(
      within(menu)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual([
      "개요",
      "신고",
      "공개 노트",
      "사용자",
      "요금제",
      "프롬프트",
      "추출 결과",
      "관리자",
      "작업 기록",
    ]);
    expect(within(menu).getByRole("link", { name: "신고" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByText("내용")).toBeInTheDocument();
    // Korean on every page breaks only between words.
    expect(screen.getByText("내용").parentElement).toHaveClass("break-keep");
  });

  it("gives a revoked admin the not-found page at once", async () => {
    admin.admins.delete(testUser.id);
    await expect(render(AdminGate, { children: <p>내용</p> })).rejects.toMatchObject(notFound);
  });
});

/** The UTC day [offset] days from now, as YYYY-MM-DD. */
const utcDay = (offset = 0) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

describe("the overview", () => {
  it("shows users and study, and the last 30 days of photos with their cost by day, plan, model and version", async () => {
    // Haiku, the Free plan's model, is measured at $0.0018 a photo; Sonnet at $0.0267.
    admin.breakdown = [
      { day: utcDay(-1), plan: null, model: null, prompt_version_id: null, photos: 10 },
      {
        day: utcDay(),
        plan: "free",
        model: "anthropic/claude-haiku-5.5",
        prompt_version_id: 2,
        photos: 5,
      },
      {
        day: utcDay(),
        plan: "pro",
        model: "anthropic/claude-sonnet-5.5",
        prompt_version_id: 2,
        photos: 1,
      },
    ];
    // The session's token holds for an hour from now, so the clock stays real.
    const now = Date.now();
    await render(OverviewContent, {});

    const users = screen.getByRole("region", { name: "사용자" });
    expect(within(users).getByText("전체").nextSibling).toHaveTextContent("2명");
    const photos = within(screen.getByRole("region", { name: "사진 추출" }));
    expect(photos.getByText("오늘").nextSibling).toHaveTextContent("6장 · $0.0357");
    expect(photos.getByText("최근 30일").nextSibling).toHaveTextContent("16장 · $0.0537");
    expect(
      photos.getByRole("img", { name: /^최근 30일 사진 16장 · \$0\.0537\. 가장 많은 날은/ }),
    ).toHaveAccessibleName(
      `최근 30일 사진 16장 · $0.0537. 가장 많은 날은 ${utcDay(-1)}, 10장이에요.`,
    );
    const byDay = within(photos.getByRole("table", { name: "날짜별 사진과 예상 비용" }));
    expect(
      byDay
        .getAllByRole("row")
        .slice(1, 3)
        .map((row) => row.textContent),
    ).toEqual([`${utcDay()}6장$0.0357`, `${utcDay(-1)}10장$0.0180`]);
    expect(byDay.getAllByRole("row")).toHaveLength(31);
    const byPlan = within(photos.getByRole("table", { name: "요금제" }));
    expect(
      byPlan
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.textContent),
    ).toEqual(["무료5장$0.0090", "프로1장$0.0267", "기록 전10장$0.0180"]);
    expect(
      photos.getByRole("img", {
        name: "요금제별 예상 비용, 최근 30일: 무료 $0.0090, 프로 $0.0267, 기록 전 $0.0180.",
      }),
    ).toBeInTheDocument();
    const byVersion = within(photos.getByRole("table", { name: "버전" }));
    expect(byVersion.getByRole("link", { name: "버전 2" })).toHaveAttribute(
      "href",
      "/admin/prompts/2",
    );
    expect(
      byVersion
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.textContent),
    ).toEqual(["버전 26장$0.0357", "기록 전10장$0.0180"]);
    // Today and the last 7 days of study are study days from 04:00 in the browser's zone.
    const call = admin.calls.find((made) => made.startsWith("admin_overview "));
    const args = JSON.parse(call?.slice("admin_overview ".length) ?? "{}") as Record<
      string,
      string
    >;
    const today = studyDayStart(now, "UTC");
    expect(new Date(today).toISOString().slice(11)).toBe("04:00:00.000Z");
    expect(args).toEqual({
      today_start: new Date(today).toISOString(),
      week_start: new Date(studyDayStart(now - 6 * 86_400_000, "UTC")).toISOString(),
    });
    expect(admin.calls).toContain('admin_extraction_breakdown {"days":30}');
  });

  it("says when there were no photos in the last 30 days", async () => {
    await render(OverviewContent, {});
    expect(
      screen.getByRole("img", { name: "최근 30일 동안 사진 추출이 없어요." }),
    ).toBeInTheDocument();
  });

  it("says a user who is not an admin may not see it, against an admin's figures", async () => {
    await signIn(otherUser);
    await render(OverviewContent, {});
    expect(screen.getByRole("alert")).toHaveTextContent("관리자만 볼 수 있어요.");
    expect(screen.queryByRole("region", { name: "사용자" })).not.toBeInTheDocument();
  });
});

describe("the reports page", () => {
  it("lists a reported deck with its reasons and state, and its actions", async () => {
    await render(ReportsContent, {});
    const row = screen.getByRole("listitem");
    expect(within(row).getByRole("link", { name: "French" })).toHaveAttribute(
      "href",
      `/admin/decks/${french}`,
    );
    // The row's line carries more than the count, so a substring is right.
    expect(row).toHaveTextContent(/신고 2건 · 저작권 침해, 스팸/);
    expect(within(row).getByText("공개")).toBeInTheDocument();
    expect(
      within(row)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["숨기기", "비공개로 전환", "신고 정리"]);
  });

  it("asks before it hides a deck, does nothing on 취소, and records the hide once confirmed", async () => {
    const user = userEvent.setup();
    await render(ReportsContent, {});
    await user.click(screen.getByRole("button", { name: "숨기기" }));
    const question = screen.getByRole("group", { name: "'French' 노트를 공개 목록에서 숨길까요?" });
    expect(within(question).getByRole("button", { name: "숨기기" })).toHaveFocus();
    // A reversible action's confirm comes last, after 취소, in the ink fill.
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
  });

  it("says when there are no reports", async () => {
    admin.decks.length = 0;
    await render(ReportsContent, {});
    expect(
      screen.getByText("신고된 노트가 없어요. 새 신고가 들어오면 여기에 보여요."),
    ).toBeInTheDocument();
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

describe("the public decks page", () => {
  it("lists public decks by name, with their counts, and says when the search finds none", async () => {
    await render(PublicDecksContent, { searchParams: Promise.resolve({}) });
    const row = screen.getByRole("listitem");
    // The line carries the owner and counts together.
    expect(row).toHaveTextContent(/other@example.com · 카드 2장 · 가져오기 3회 · 신고 2건/);
    expect(screen.queryByText("Diary")).not.toBeInTheDocument();

    await render(PublicDecksContent, { searchParams: Promise.resolve({ q: "spanish" }) });
    expect(screen.getByText("찾는 노트가 없어요. 다른 단어로 검색해 보세요.")).toBeInTheDocument();
  });
});

describe("a deck's page", () => {
  it("shows a reported deck read-only with its cards and actions", async () => {
    await render(DeckContent, { params: Promise.resolve({ id: french }) });
    expect(screen.getByRole("heading", { name: "French" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "other@example.com" })).toHaveAttribute(
      "href",
      `/admin/users/${otherUser.id}`,
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

/** Adds [count] users whose emails are `user01@example.com` onward. */
function seedUsers(count: number) {
  for (let index = 1; index <= count; index++) {
    const number = String(index).padStart(2, "0");
    admin.users.push({
      id: `a0000000-0000-4000-8000-0000000000${number}`,
      email: `user${number}@example.com`,
      createdAt: "2026-10-10T00:00:00Z",
      lastAnswerAt: null,
      decks: 0,
      cards: 0,
      extractionsToday: 0,
    });
  }
}

/** The emails the users list shows. */
const listedEmails = () =>
  screen
    .queryAllByRole("listitem")
    .map((item) => item.textContent.split("정지")[0]?.split("2026")[0]);

describe("the users pages", () => {
  it("finds users by email and opens one, read-only, with the period's photos against the plan's limit", async () => {
    await render(UsersContent, { searchParams: Promise.resolve({ q: "OTHER" }) });
    expect(screen.getByRole("link", { name: /other@example.com/ })).toHaveAttribute(
      "href",
      `/admin/users/${otherUser.id}`,
    );

    await render(UserContent, { params: Promise.resolve({ id: otherUser.id }) });
    expect(screen.getByRole("heading", { name: "other@example.com" })).toBeInTheDocument();
    expect(screen.getByText("이번 달 사진 추출").nextSibling).toHaveTextContent("4장 / 한 달 10장");
    expect(screen.getByText("마지막 학습").nextSibling).toHaveTextContent("2026-10-18 09:30");
    expect(
      within(screen.getByRole("region", { name: "공개 노트" })).getByRole("link", {
        name: "French",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /삭제|편집/ })).not.toBeInTheDocument();
  });

  it("says when the search finds no one, and shows no list before a search", async () => {
    await render(UsersContent, { searchParams: Promise.resolve({ q: "nobody" }) });
    expect(
      screen.getByText("찾는 사용자가 없어요. 다른 단어로 검색해 보세요."),
    ).toBeInTheDocument();
    await render(UsersContent, { searchParams: Promise.resolve({}) });
    expect(admin.calls.filter((call) => call.startsWith("admin_search_users"))).toHaveLength(1);
  });

  it("searches as the admin types, once after the typing pauses, and updates the list in place", async () => {
    const user = userEvent.setup();
    await render(UsersContent, { searchParams: Promise.resolve({ q: "learner" }) });
    expect(listedEmails()).toEqual([testUser.email]);

    const field = screen.getByRole("searchbox", { name: "이메일 검색" });
    await user.clear(field);
    await user.type(field, "other");
    await vi.waitFor(() => {
      expect(listedEmails()).toEqual([otherUser.email]);
    });
    expect(screen.getByRole("status")).toHaveTextContent("1명");
    // One search for the page's own query, and one for the whole typed word.
    expect(admin.calls.filter((call) => call.startsWith("admin_search_users"))).toHaveLength(2);
  });

  it("shows twenty users at a time, the prefix matches first, and adds the next page on 더 보기", async () => {
    const user = userEvent.setup();
    seedUsers(21);
    await render(UsersContent, { searchParams: Promise.resolve({ q: "user" }) });
    expect(screen.getByRole("status")).toHaveTextContent("21명");
    expect(listedEmails()).toHaveLength(20);
    expect(listedEmails()[0]).toBe("user01@example.com");

    await user.click(screen.getByRole("button", { name: "더 보기" }));
    await vi.waitFor(() => {
      expect(listedEmails()).toHaveLength(21);
    });
    expect(listedEmails()[20]).toBe("user21@example.com");
    expect(screen.queryByRole("button", { name: "더 보기" })).not.toBeInTheDocument();
  });

  it("keeps the search and the pages shown in the address, so coming back from a user shows them again", async () => {
    const user = userEvent.setup();
    seedUsers(21);
    window.history.replaceState(null, "", "/admin/users");
    const view = await render(UsersContent, { searchParams: Promise.resolve({}) });

    await user.type(screen.getByRole("searchbox", { name: "이메일 검색" }), "user");
    await vi.waitFor(() => {
      expect(listedEmails()).toHaveLength(20);
    });
    expect(window.location.pathname + window.location.search).toBe("/admin/users?q=user");
    // 더 보기 stays disabled until the search's transition has settled.
    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: "더 보기" })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: "더 보기" }));
    await vi.waitFor(() => {
      expect(listedEmails()).toHaveLength(21);
    });
    expect(window.location.search).toBe("?q=user&page=1");

    // Back from a user's page opens the address again, which reads both pages on the server.
    view.unmount();
    const params = Object.fromEntries(new URLSearchParams(window.location.search));
    await render(UsersContent, { searchParams: Promise.resolve(params) });
    expect(screen.getByRole("searchbox", { name: "이메일 검색" })).toHaveValue("user");
    expect(listedEmails()).toHaveLength(21);
    expect(screen.queryByRole("button", { name: "더 보기" })).not.toBeInTheDocument();
  });

  it("reads the first page alone for an address whose page is no whole number", async () => {
    seedUsers(21);
    for (const page of ["x", "-1", "1.5", ""]) {
      const view = await render(UsersContent, {
        searchParams: Promise.resolve({ q: "user", page }),
      });
      expect(listedEmails(), page).toHaveLength(20);
      view.unmount();
    }
    // Control: a whole number reads through that page.
    await render(UsersContent, { searchParams: Promise.resolve({ q: "user", page: "1" }) });
    expect(listedEmails()).toHaveLength(21);
  });

  it("lists every live deck of a user, private ones too, each opening the deck", async () => {
    await render(UserContent, { params: Promise.resolve({ id: otherUser.id }) });
    const decks = within(screen.getByRole("region", { name: "노트" }));
    expect(decks.getByRole("link", { name: /Diary/ })).toHaveAttribute(
      "href",
      `/admin/decks/${diary}`,
    );
    expect(decks.getByRole("link", { name: /French/ })).toHaveTextContent("카드 2장");
  });
});

describe("a user's suspension", () => {
  it("suspends a user with a reason once confirmed, shows it, and lifts it", async () => {
    const user = userEvent.setup();
    await render(UserContent, { params: Promise.resolve({ id: otherUser.id }) });
    const section = within(screen.getByRole("region", { name: "이용 정지" }));
    await user.click(section.getByRole("button", { name: "이용 정지" }));
    await user.type(section.getByLabelText("정지하는 이유"), "spam decks");
    await user.click(section.getByRole("button", { name: "정지" }));
    expect(await section.findByRole("status")).toHaveTextContent("이용을 정지했어요.");
    expect(admin.suspensions.get(otherUser.id)).toEqual({ reason: "spam decks", by: testUser.id });

    await render(UserContent, { params: Promise.resolve({ id: otherUser.id }) });
    expect(screen.getByText("정지됨 · spam decks")).toBeInTheDocument();
    await render(UsersContent, { searchParams: Promise.resolve({ q: "other" }) });
    expect(screen.getByRole("link", { name: /other@example.com/ })).toHaveTextContent("정지 ·");

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
    const rows = screen.getAllByRole("listitem");
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

describe("the audit log", () => {
  it("shows each write, newest first, with who acted and on what", async () => {
    await hideDeck(french);
    const data = new FormData();
    data.set("email", "other@example.com");
    await grantAdmin({ message: null }, data);
    await render(AuditContent, {});
    expect(screen.getAllByRole("listitem").map((entry) => entry.firstChild?.textContent)).toEqual([
      "관리자 지정 · other@example.com",
      "노트 숨기기 · French",
    ]);
    expect(screen.getByRole("link", { name: "French" })).toHaveAttribute(
      "href",
      `/admin/decks/${french}`,
    );
  });

  it("names a suspension and a removal from sharing, with each one's reason", async () => {
    await suspendUser(otherUser.id, "spam decks");
    await unsuspendUser(otherUser.id);
    await removeDeck(french, "copyright");
    await render(AuditContent, {});
    expect(screen.getAllByRole("listitem").map((entry) => entry.firstChild?.textContent)).toEqual([
      "공유에서 영구 삭제 · French · copyright",
      "정지 해제 · other@example.com",
      "이용 정지 · other@example.com · spam decks",
    ]);
  });

  it("is refused to a user who is not an admin", async () => {
    await signIn(otherUser);
    await render(AuditContent, {});
    expect(screen.getByRole("alert")).toHaveTextContent("관리자만 볼 수 있어요.");
  });
});

/** OpenRouter's public model list: Haiku takes images with structured outputs; the text model does not. */
const openRouterModels = http.get("https://openrouter.ai/api/v1/models", () =>
  HttpResponse.json({
    data: [
      {
        id: "anthropic/claude-haiku-5.5",
        architecture: { input_modalities: ["text", "image"] },
        supported_parameters: ["structured_outputs", "max_tokens"],
      },
      {
        id: "openai/gpt-6-luna",
        architecture: { input_modalities: ["text", "image"] },
        supported_parameters: ["structured_outputs"],
      },
      {
        id: "vendor/text-only",
        architecture: { input_modalities: ["text"] },
        supported_parameters: ["structured_outputs"],
      },
      {
        id: "vendor/no-schema",
        architecture: { input_modalities: ["text", "image"] },
        supported_parameters: ["max_tokens"],
      },
    ],
  }),
);

/** A form of [fields], as the browser posts it. */
function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

describe("the plans page", () => {
  it("shows the version each plan's new subscribers take with its measured cost, a form for a new version, and every version", async () => {
    admin.planVersions.push({
      id: 7,
      plan: "pro",
      quota: "daily",
      amount: 100,
      model: "openai/gpt-6-luna",
      starts_at: "2026-10-26T00:00:01Z",
      applies_to_all: false,
      created_by: testUser.id,
    });
    await render(PlansContent, {});
    const free = within(screen.getByRole("region", { name: "무료" }));
    expect(
      free.getByText("지금 가입하면 한 달 10장 · anthropic/claude-haiku-5.5"),
    ).toBeInTheDocument();
    expect(free.getByText("측정 비용 사진 한 장에 $0.0018")).toBeInTheDocument();
    expect(free.getByRole("combobox", { name: "한도" })).toHaveValue("monthly");
    expect(free.getByRole("spinbutton", { name: "사진 장 수" })).toHaveValue(10);
    expect(free.getByRole("textbox", { name: "모델" })).toHaveValue("anthropic/claude-haiku-5.5");
    expect(
      within(free.getByRole("list", { name: "무료 버전" }))
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toEqual([
      "한 달 10장 · anthropic/claude-haiku-5.5 · 지금 가입 시 적용2026-10-26 00:00부터 · 기존 사용자는 갱신일부터",
      "하루 30장 · anthropic/claude-haiku-5.52026-10-19 00:00부터 · 기존 사용자는 갱신일부터",
    ]);
    const pro = within(screen.getByRole("region", { name: "프로" }));
    expect(pro.getByText("이 모델은 측정한 비용이 없어요.")).toBeInTheDocument();
    // The row carries its start and author after its terms, so a substring is right.
    expect(pro.getByText(/learner@example.com/)).toBeInTheDocument();
    const max = within(screen.getByRole("region", { name: "맥스" }));
    expect(
      max.getByText("지금 가입하면 무제한 (하루 1000장까지) · anthropic/claude-haiku-5.5"),
    ).toBeInTheDocument();
    expect(max.getByText(/기존 사용자도 적용/)).toBeInTheDocument();
    const measured = within(screen.getByRole("region", { name: "측정한 모델" }));
    expect(measured.getAllByRole("listitem").map((row) => row.textContent)).toEqual([
      "anthropic/claude-haiku-5.5$0.0018",
      "anthropic/claude-sonnet-5.5$0.0267",
    ]);
  });

  it("creates a version from now when OpenRouter lists the model with images and structured outputs, records it, and says when the terms are the current ones", async () => {
    server.use(openRouterModels);
    const create = () =>
      createPlanVersion(
        { message: null },
        form({ plan: "pro", quota: "daily", amount: "200", model: "openai/gpt-6-luna" }),
      );
    expect(await create()).toEqual({ message: "새 버전을 만들었어요." });
    expect(admin.planVersions.at(-1)).toMatchObject({
      plan: "pro",
      quota: "daily",
      amount: 200,
      model: "openai/gpt-6-luna",
      applies_to_all: false,
    });
    expect(admin.audit).toMatchObject([
      { action: "create_plan_version", target_kind: "plan", target_id: "pro" },
    ]);
    expect(revalidated).toEqual(["/admin"]);
    expect(await create()).toEqual({ message: "지금 버전과 같아요." });
  });

  it("starts a version at 00:00 in Seoul on the day chosen, refuses a day already past, and applies one to existing users only in their favour", async () => {
    server.use(openRouterModels);
    const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const create = (fields: Record<string, string>) =>
      createPlanVersion(
        { message: null },
        form({ model: "anthropic/claude-haiku-5.5", ...fields }),
      );
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
      message:
        "기존 사용자에게 바로 적용할 수 있는 건 같은 모델에서 사진을 줄이지 않는 변경뿐이에요.",
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

  it("cannot save a model OpenRouter does not list, one without images or structured outputs, a malformed id or amount, or any while OpenRouter cannot be reached", async () => {
    server.use(openRouterModels);
    const versions = admin.planVersions.length;
    const attempt = (model: string, amount = "30") =>
      createPlanVersion({ message: null }, form({ plan: "free", quota: "daily", model, amount }));
    expect(await attempt("vendor/unknown")).toEqual({
      message: "OpenRouter에 없는 모델이에요. 모델 ID를 확인해 주세요.",
    });
    for (const model of ["vendor/text-only", "vendor/no-schema"]) {
      expect(await attempt(model), model).toEqual({
        message: "사진과 구조화된 답을 함께 지원하지 않는 모델이에요.",
      });
    }
    expect(await attempt("not a model")).toEqual({
      message: "모델 ID는 vendor/model 꼴로 적어 주세요.",
    });
    expect(await attempt("anthropic/claude-haiku-5.5", "100001")).toEqual({
      message: "사진 장 수는 0에서 100000 사이의 정수로 적어 주세요.",
    });
    server.use(
      http.get(
        "https://openrouter.ai/api/v1/models",
        () => new HttpResponse(null, { status: 503 }),
      ),
    );
    expect(await attempt("openai/gpt-6-luna")).toEqual({
      message: "OpenRouter에 연결할 수 없어 모델을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
    });
    expect(admin.planVersions).toHaveLength(versions);
    expect(admin.calls.some((call) => call.startsWith("admin_create_plan_version"))).toBe(false);
  });

  it("refuses a user who is not an admin, and changes nothing", async () => {
    server.use(openRouterModels);
    const versions = admin.planVersions.length;
    await signIn(otherUser);
    expect(
      await createPlanVersion(
        { message: null },
        form({ plan: "free", quota: "daily", model: "openai/gpt-6-luna", amount: "5" }),
      ),
    ).toEqual({ message: "관리자만 할 수 있어요." });
    expect(admin.planVersions).toHaveLength(versions);
    await render(PlansContent, {});
    expect(screen.getByRole("alert")).toHaveTextContent("관리자만 볼 수 있어요.");
  });

  it("costs a photo without a call record at the model of Free's current version, and leaves out one a never-measured model served", async () => {
    const free = admin.planVersions.find((entry) => entry.plan === "free" && entry.amount === 10);
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
    await render(OverviewContent, {});
    const photos = within(screen.getByRole("region", { name: "사진 추출" }));
    expect(photos.getByText("오늘").nextSibling).toHaveTextContent(
      "5장 · $0.0018 (비용 모르는 4장 제외)",
    );
    expect(
      photos.getByText(/측정하지 않은 모델\(openai\/gpt-6-luna\)의 사진은 비용에서 빠졌어요/),
    ).toBeInTheDocument();
  });
});

describe("a user's plan", () => {
  it("shows Free with its terms, grants Max until a day's end in the admin's zone, and goes back to Free", async () => {
    await render(UserContent, { params: Promise.resolve({ id: otherUser.id }) });
    const plan = within(screen.getByRole("region", { name: "요금제" }));
    expect(plan.getByText("무료 · anthropic/claude-haiku-5.5 · 한 달 10장")).toBeInTheDocument();
    expect(plan.queryByRole("button", { name: "무료로 되돌리기" })).not.toBeInTheDocument();

    const ends = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    expect(
      await grantPlan({ message: null }, form({ user: otherUser.id, plan: "max", ends_on: ends })),
    ).toEqual({ message: "맥스로 지정했어요." });
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
    expect(
      granted.getByText("맥스 · anthropic/claude-haiku-5.5 · 무제한 (하루 1000장까지)"),
    ).toBeInTheDocument();
    // The grant's line carries its time and granter too, so a substring is right.
    expect(granted.getByText(new RegExp(`${ends}까지`))).toBeInTheDocument();
    expect(granted.getByRole("button", { name: "무료로 되돌리기" })).toBeInTheDocument();

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
    ).toEqual({ message: "끝나는 날은 맥스에만 정할 수 있어요." });
    expect(
      await grantPlan(
        { message: null },
        form({ user: otherUser.id, plan: "max", ends_on: "2020-01-01" }),
      ),
    ).toEqual({ message: "끝나는 날은 오늘 이후로 정해 주세요." });
    expect(
      await grantPlan(
        { message: null },
        form({ user: otherUser.id, plan: "special", ends_on: "" }),
      ),
    ).toEqual({ message: "하지 못했어요. 잠시 후 다시 시도해 주세요." });
    expect(
      await grantPlan({ message: null }, form({ user: otherUser.id, plan: "pro", ends_on: "" })),
    ).toEqual({ message: "프로로 지정했어요." });

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
    server.use(openRouterModels);
    await createPlanVersion(
      { message: null },
      form({
        plan: "pro",
        quota: "daily",
        amount: "200",
        model: "openai/gpt-6-luna",
        applies_to_all: "",
      }),
    );
    await grantPlan({ message: null }, form({ user: otherUser.id, plan: "pro", ends_on: "" }));
    await render(AuditContent, {});
    expect(screen.getAllByRole("listitem").map((entry) => entry.firstChild?.textContent)).toEqual([
      "요금제 지정 · other@example.com · 프로",
      "요금제 새 버전 · 프로 · openai/gpt-6-luna · 하루 200장",
    ]);
    expect(screen.getByRole("link", { name: "프로" })).toHaveAttribute("href", "/admin/plans");
  });
});
