import { cleanup, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { http, HttpResponse } from "msw";

import { FakeAdmin } from "@/testing/mocks/admin";
import { otherUser, supabaseUrl, testUser } from "@/testing/mocks/handlers";
import { server } from "@/testing/mocks/server";
import { setRequestCookies } from "@/testing/next-headers";
import { render } from "@/testing/render";
import { signedInCookies } from "@/testing/session";

import { AiContent, PromptContent } from "../_components/content";

vi.mock("next/headers", () => import("@/testing/next-headers"));

/** Signs the next request in as [user], with the browser's zone UTC. */
async function signIn(user: typeof testUser | typeof otherUser = testUser) {
  setRequestCookies([...(await signedInCookies(user)), { name: "smartman-tz", value: "UTC" }]);
}

/** The UTC day [offset] days from now, as YYYY-MM-DD. */
const utcDay = (offset = 0) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/** A recorded call of version 1 as the server holds it. */
function call(id: number, fields: Record<string, unknown> = {}) {
  return {
    usage_id: id,
    created_at: "2026-11-01T03:04:00Z",
    plan: "free",
    model: "anthropic/claude-haiku-5.5",
    prompt_version_id: 1,
    outcome: "ok",
    attempts: 1,
    latency_ms: 12_345,
    cards_returned: 14,
    cards_dropped: 0,
    failures: [],
    ...fields,
  };
}

/** One day's counts for one version as `admin_extraction_failures` answers them. */
function counts(day: string, version: number, fields: Record<string, number>) {
  return {
    day,
    prompt_version_id: version,
    calls: 0,
    ok: 0,
    no_cards: 0,
    invalid_output: 0,
    model_error: 0,
    retried: 0,
    recovered: 0,
    failure_rate: null,
    unrecorded: 0,
    ...fields,
  };
}

const unrecorded = {
  outcome: null,
  attempts: null,
  latency_ms: null,
  cards_returned: null,
  cards_dropped: null,
  failures: null,
};

const version = (id: string, before?: string) =>
  render(PromptContent, {
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve(before === undefined ? {} : { before }),
  });

let admin: FakeAdmin;
beforeEach(async () => {
  admin = new FakeAdmin();
  server.use(...admin.handlers);
  admin.prompts.push({ id: 2, text: "Prompt v9.\nName the rule.", note: "prompt v9", by: null });
  admin.promptLabels.set("test", 2);
  await signIn();
});

describe("사진 AI", () => {
  it("shows the active prompt's week, the test prompt's month and each version's 30 days, each opening the version", async () => {
    admin.extractionFailures = [
      // Version 1: a failure 10 days ago, outside the week, and 1 in 20 this week.
      counts(utcDay(-10), 1, { calls: 10, ok: 9, invalid_output: 1 }),
      counts(utcDay(-1), 1, { calls: 20, ok: 18, no_cards: 1, model_error: 1 }),
      // Version 2, under test: 2 of 25 failed.
      counts(utcDay(), 2, { calls: 25, ok: 23, invalid_output: 2 }),
    ];
    await render(AiContent, {});

    const active = within(screen.getByRole("region", { name: "사용 중 프롬프트" }));
    expect(active.getByText("버전 1")).toBeInTheDocument();
    expect(active.getByText("실패율 5.0% · 최근 7일")).toBeInTheDocument();
    expect(active.getByRole("link", { name: "새 버전 쓰기" })).toHaveAttribute("href", "/ai/new");

    const test = within(screen.getByRole("region", { name: "테스트 중" }));
    expect(test.getByText("버전 2")).toBeInTheDocument();
    expect(test.getByText("실패율 8.0% · 관리자 25회")).toBeInTheDocument();
    expect(test.getByRole("button", { name: "모두에게 적용" })).toBeInTheDocument();

    expect(screen.getByRole("region", { name: "사진 한 장으로 시험" })).toHaveTextContent(
      "테스트 버전 2로 카드를 만들어요.",
    );

    const results = within(screen.getByRole("region", { name: "버전별 결과" }));
    const rows = results.getAllByRole("link");
    expect(rows.map((row) => row.getAttribute("href"))).toEqual(["/ai/2", "/ai/1"]);
    // A row carries the version, its labels, counts and rate together, so a substring is right.
    expect(rows[1]).toHaveTextContent(
      /버전 1사용 중prompt v8추출 30건 · 카드 없음 1 · 형식 오류 1 · 모델 오류 16\.7%/,
    );
    expect(rows[0]).toHaveTextContent(/8\.0%$/);
    expect(admin.calls).toContain('admin_extraction_failures {"days":30}');
  });

  it("draws a version's rate red over 5%, against one at 5%", async () => {
    admin.extractionFailures = [
      counts(utcDay(), 1, { calls: 20, ok: 19, invalid_output: 1 }),
      counts(utcDay(), 2, { calls: 20, ok: 18, invalid_output: 2 }),
    ];
    await render(AiContent, {});
    const results = within(screen.getByRole("region", { name: "버전별 결과" }));
    expect(results.getByText("10.0%")).toHaveClass("text-dont-know-text");
    // Control: 5.0% is not over the line.
    expect(results.getByText("5.0%")).not.toHaveClass("text-dont-know-text");
  });

  it("says when no version is under test, and offers no 모두에게 적용", async () => {
    admin.promptLabels.delete("test");
    await render(AiContent, {});
    const test = within(screen.getByRole("region", { name: "테스트 중" }));
    expect(test.getByText("없음")).toBeInTheDocument();
    expect(test.queryByRole("button", { name: "모두에게 적용" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "사진 한 장으로 시험" })).toHaveTextContent(
      "사용 중인 버전 1로 카드를 만들어요.",
    );
  });

  it("says a user who is not an admin may not see it", async () => {
    await signIn(otherUser);
    await render(AiContent, {});
    expect(screen.getByRole("alert")).toHaveTextContent("관리자만 볼 수 있어요.");
    expect(screen.queryByRole("region", { name: "버전별 결과" })).not.toBeInTheDocument();
  });

  it("says it could not load when the server fails, with a way to try again", async () => {
    server.use(
      http.post(`${supabaseUrl}/rest/v1/rpc/admin_extraction_failures`, () =>
        HttpResponse.json({ code: "P0001", message: "boom" }, { status: 400 }),
      ),
    );
    await render(AiContent, {});
    expect(screen.getByRole("alert")).toHaveTextContent(
      "불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
    );
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });
});

describe("a version's page", () => {
  it("shows that version's 30 days by day, leaving out another version's", async () => {
    admin.extractionFailures = [
      counts(utcDay(-1), 1, { calls: 10, ok: 6, invalid_output: 3, model_error: 1 }),
      counts(utcDay(), 1, { calls: 40, ok: 39, no_cards: 1 }),
      counts(utcDay(), 2, { calls: 10, invalid_output: 10 }),
    ];
    await version("1");

    expect(
      screen.getByText("최근 30일 추출 50건 · 카드 없음 1 · 형식 오류 3 · 모델 오류 1"),
    ).toBeInTheDocument();
    const daily = within(screen.getByRole("region", { name: "날짜별 실패율" }));
    expect(daily.getByRole("img")).toHaveAccessibleName(
      `날짜별 실패율, 최근 30일: ${utcDay(-1).slice(5)} 40.0%, ${utcDay().slice(5)} 0.0%`,
    );
  });

  it("lists that version's recent extractions with their time, plan, outcome, calls, latency and cards, and no user", async () => {
    admin.extractionCalls = [
      call(43, { prompt_version_id: 2 }),
      call(42, { cards_dropped: 2 }),
      call(41, {
        plan: "pro",
        outcome: "model_error",
        attempts: 2,
        latency_ms: 95_000,
        cards_returned: 0,
        failures: ["timeout", "model_error"],
      }),
      call(40, { outcome: "ok", attempts: 2, failures: ["invalid_output"] }),
      call(39, unrecorded),
    ];
    const { container } = await version("1");

    const list = within(screen.getByRole("list", { name: "최근 추출" }));
    expect(list.getAllByRole("listitem").map((row) => row.textContent)).toEqual([
      "성공2026-11-01 03:04무료 · 시도 1회 · 12.3초 · 카드 14장 · 거른 카드 2장",
      "모델 오류2026-11-01 03:04프로 · 시도 2회 (시간 초과, 모델 오류) · 95.0초 · 카드 0장",
      "성공2026-11-01 03:04무료 · 시도 2회 (형식 오류) · 12.3초 · 카드 14장",
      "기록 없음2026-11-01 03:04무료",
    ]);
    // Nothing names the user each call served.
    for (const user of [testUser, otherUser]) {
      expect(container.innerHTML).not.toContain(user.id);
      expect(container.innerHTML).not.toContain(user.email);
    }
    expect(admin.calls).toContain(
      'admin_version_calls {"version_id":1,"before":null,"page_size":50}',
    );
    // A page shorter than a full one is the last.
    expect(screen.queryByRole("link", { name: "이전 추출 더 보기" })).not.toBeInTheDocument();
  });

  it("links a full page to the one before it, and that page back to the newest", async () => {
    admin.extractionCalls = Array.from({ length: 60 }, (_, index) => call(1000 - index));
    await version("1");
    expect(
      within(screen.getByRole("list", { name: "최근 추출" })).getAllByRole("listitem"),
    ).toHaveLength(50);
    expect(screen.getByRole("link", { name: "이전 추출 더 보기" })).toHaveAttribute(
      "href",
      "/ai/1?before=951",
    );
    expect(screen.queryByRole("link", { name: "최신 추출로" })).not.toBeInTheDocument();

    cleanup();
    await version("1", "951");
    expect(admin.calls).toContain(
      'admin_version_calls {"version_id":1,"before":951,"page_size":50}',
    );
    expect(
      within(screen.getByRole("list", { name: "최근 추출" })).getAllByRole("listitem"),
    ).toHaveLength(10);
    expect(screen.getByRole("link", { name: "최신 추출로" })).toHaveAttribute("href", "/ai/1");
    expect(screen.queryByRole("link", { name: "이전 추출 더 보기" })).not.toBeInTheDocument();
  });

  it("says when nothing was recorded, on the newest page and before it", async () => {
    await version("1");
    expect(
      screen.getByText("이 버전으로 기록된 추출이 없어요. 사진으로 카드를 만들면 여기에 쌓여요."),
    ).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAccessibleName("날짜별 실패율: 기록된 추출이 없어요.");

    cleanup();
    await version("1", "12");
    expect(
      screen.getByText("이보다 이전 추출이 없어요. 최신 추출로 돌아가 보세요."),
    ).toBeInTheDocument();
  });

  it("says it could not read an answer whose outcome's parts disagree, against one whose agree", async () => {
    admin.extractionCalls = [call(42, { ...unrecorded, attempts: 1 })];
    await version("1");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "받은 답을 읽지 못했어요. 페이지를 새로 고친 뒤 다시 시도해 주세요.",
    );

    // Control: the same row with every part of its outcome null is read.
    cleanup();
    admin.extractionCalls = [call(42, unrecorded)];
    await version("1");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "최근 추출" })).toHaveTextContent("기록 없음");
  });
});
