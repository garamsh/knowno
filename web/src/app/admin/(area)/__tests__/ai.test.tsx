import { cleanup, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FakeAdmin } from "@/testing/mocks/admin";
import { otherUser, supabaseUrl, testUser } from "@/testing/mocks/handlers";
import { server } from "@/testing/mocks/server";
import { setRequestCookies } from "@/testing/next-headers";
import { render } from "@/testing/render";
import { signedInCookies } from "@/testing/session";

import { AiContent } from "../_components/content";

vi.mock("next/headers", () => import("@/testing/next-headers"));

/** Signs the next request in as [user], with the browser's zone UTC. */
async function signIn(user: typeof testUser | typeof otherUser = testUser) {
  setRequestCookies([...(await signedInCookies(user)), { name: "smartman-tz", value: "UTC" }]);
}

/** One configuration's counts as `admin_configuration_results` answers them. */
function result(model: string, version: number, fields: Record<string, number | null>) {
  return {
    provider: "openrouter",
    model,
    prompt_version_id: version,
    calls: 0,
    ok: 0,
    no_cards: 0,
    invalid_output: 0,
    model_error: 0,
    failure_rate: null,
    unrecorded: 0,
    ...fields,
  };
}

const haiku = "anthropic/claude-haiku-5.5";

/** AI as the address [params] opens it. */
const ai = (params: Record<string, string> = {}) =>
  render(AiContent, { searchParams: Promise.resolve(params) });

/** The cells of each body row of the table named [name], each cell's text. */
function cells(name: string): string[][] {
  return within(screen.getByRole("table", { name }))
    .getAllByRole("row")
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    );
}

let admin: FakeAdmin;
beforeEach(async () => {
  admin = new FakeAdmin();
  server.use(...admin.handlers);
  admin.prompts.push({ id: 2, text: "Prompt v8.\nName the rule.", note: "prompt v9", by: null });
  // Pro's draft: the same provider and model, prompt v2.
  admin.aiConfigurations.push({
    id: 5,
    plan: "pro",
    label: "test",
    provider: "openrouter",
    model: haiku,
    prompt_version_id: 2,
    created_by: testUser.id,
  });
  await signIn();
});

describe("AI's plans", () => {
  it("lists each plan's provider, model, prompt, cost per photo, week's failure rate and draft, each opening its panel", async () => {
    const pro = admin.aiConfigurations[1];
    if (pro === undefined) throw new Error("the seed has Pro's configuration");
    admin.aiConfigurations[1] = { ...pro, model: "anthropic/claude-sonnet-9" };
    admin.configurationResults.set(7, [
      // Free's, Max's and 스페셜's configuration: 1 in 20 failed.
      result(haiku, 1, { calls: 20, ok: 19, model_error: 1, failure_rate: 0.05 }),
      // Pro's draft, which the row of Pro's active configuration does not count.
      result(haiku, 2, { calls: 4, ok: 2, invalid_output: 2, failure_rate: 0.5 }),
    ]);
    await ai();

    expect(cells("요금제별 사용 중인 구성")).toEqual([
      [
        "무료",
        "제공자 OpenRouter",
        `모델 ${haiku}`,
        "프롬프트 v1",
        "사진당 비용 $0.0018",
        "실패율 · 7일 5.0%",
        "초안 —",
        "바꾸기",
      ],
      [
        "프로",
        "제공자 OpenRouter",
        "모델 anthropic/claude-sonnet-9",
        "프롬프트 v1",
        "사진당 비용 측정 없음",
        "실패율 · 7일 기록 없음",
        "초안 테스트 중",
        "초안 보기",
      ],
      [
        "맥스",
        "제공자 OpenRouter",
        `모델 ${haiku}`,
        "프롬프트 v1",
        "사진당 비용 $0.0018",
        "실패율 · 7일 5.0%",
        "초안 —",
        "바꾸기",
      ],
      [
        "스페셜",
        "제공자 OpenRouter",
        `모델 ${haiku}`,
        "프롬프트 v1",
        "사진당 비용 $0.0018",
        "실패율 · 7일 5.0%",
        "초안 —",
        "바꾸기",
      ],
    ]);
    const table = within(screen.getByRole("table", { name: "요금제별 사용 중인 구성" }));
    expect(
      table.getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      ["바꾸기", "/ai?plan=free"],
      ["초안 보기", "/ai?plan=pro"],
      ["바꾸기", "/ai?plan=max"],
      ["바꾸기", "/ai?plan=special"],
    ]);
    expect(admin.calls).toContain('admin_configuration_results {"days":7}');
  });

  it("draws a week's rate over 5% red, against one at 5%", async () => {
    admin.configurationResults.set(7, [
      result(haiku, 1, { calls: 20, ok: 18, model_error: 2, failure_rate: 0.1 }),
    ]);
    await ai();
    expect(within(screen.getByRole("table")).getAllByText("10.0%")[0]).toHaveClass(
      "bg-dont-know-text",
    );

    // Control: 5.0% is not over the line.
    cleanup();
    admin.configurationResults.set(7, [
      result(haiku, 1, { calls: 20, ok: 19, model_error: 1, failure_rate: 0.05 }),
    ]);
    await ai();
    expect(within(screen.getByRole("table")).getAllByText("5.0%")[0]).not.toHaveClass(
      "bg-dont-know-text",
    );
  });
});

describe("AI's panel", () => {
  it("opens the first plan with a draft, saying what the draft changes, and its prompt's lines collapsed, in words as well as colour", async () => {
    await ai();
    const panel = within(screen.getByRole("region", { name: "프로 · 초안 (관리자만 테스트 중)" }));
    expect(
      panel.getByRole("heading", { name: "제공자·모델 그대로 · 프롬프트 v1 → v2" }),
    ).toBeInTheDocument();
    const lines = screen.getByText("프롬프트 v1 → v2 다른 점").closest("details");
    expect(lines).not.toHaveAttribute("open");
    expect(
      within(lines ?? document.body)
        .getAllByRole("listitem")
        .map((line) => line.textContent),
    ).toEqual(["Prompt v8.", "−뺌: Keep each fact.", "+더함: Name the rule."]);
    expect(panel.getByRole("button", { name: "모두에게 적용" })).toHaveClass("bg-primary");
    expect(panel.getByRole("button", { name: "테스트 끝내기" })).not.toHaveClass("bg-primary");
    // The table marks the plan shown.
    expect(screen.getAllByRole("row")[2]).toHaveClass("lg:bg-ground");
  });

  it("opens the plan the address names, and without a draft its active configuration and the form", async () => {
    await ai({ plan: "max" });
    const panel = within(screen.getByRole("region", { name: "맥스 · 사용 중인 구성" }));
    expect(
      panel.getByRole("heading", { name: `OpenRouter · ${haiku} · 프롬프트 v1` }),
    ).toBeInTheDocument();
    expect(panel.queryByRole("button", { name: "모두에게 적용" })).not.toBeInTheDocument();
    const form = within(panel.getByRole("form", { name: "맥스 새 초안" }));
    expect(form.getByRole("textbox", { name: "모델" })).toHaveValue(haiku);
    expect(form.getByRole("combobox", { name: "프롬프트" })).toHaveValue("1");
    expect(
      within(form.getByRole("combobox", { name: "프롬프트" }))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["v2", "v1"]);

    // Control: Free without a draft, when no plan has one and the address names none.
    cleanup();
    admin.aiConfigurations.pop();
    await ai({ plan: "gold" });
    expect(screen.getByRole("region", { name: "무료 · 사용 중인 구성" })).toBeInTheDocument();
  });

  it("starts a draft's form from the draft's prompt, and says what changes when everything does", async () => {
    const draft = admin.aiConfigurations.at(-1);
    if (draft === undefined) throw new Error("the test made Pro's draft");
    draft.provider = "anthropic";
    draft.model = "claude-haiku-5-5";
    await ai({ plan: "pro" });
    const panel = within(screen.getByRole("region", { name: "프로 · 초안 (관리자만 테스트 중)" }));
    expect(
      panel.getByRole("heading", {
        name: `제공자 OpenRouter → Anthropic · 모델 ${haiku} → claude-haiku-5-5 · 프롬프트 v1 → v2`,
      }),
    ).toBeInTheDocument();
    expect(panel.getByRole("combobox", { name: "프롬프트" })).toHaveValue("2");
    expect(panel.getByRole("combobox", { name: "제공자" })).toHaveValue("anthropic");
  });
});

describe("AI's prompt versions", () => {
  it("lists every version newest first with the configurations sending it, each opening the form from it", async () => {
    await ai();
    const versions = within(screen.getByRole("list", { name: "프롬프트 버전" }));
    expect(
      versions.getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      ["v2 · 초안에서 사용 · 2026-10-19prompt v9", "/ai?plan=pro&write=2"],
      ["v1 · 사용 중 · 2026-10-19prompt v8", "/ai?plan=pro&write=1"],
    ]);
    expect(screen.getByRole("link", { name: "새 버전 쓰기" })).toHaveAttribute(
      "href",
      "/ai?plan=pro&write=",
    );
    expect(screen.queryByRole("form", { name: "새 버전" })).not.toBeInTheDocument();
  });

  it("opens the new version's form from the plan's active version, or from the version the address names", async () => {
    await ai({ plan: "pro", write: "" });
    expect(screen.getByRole("textbox", { name: "프롬프트" })).toHaveValue(
      "Prompt v8.\nKeep each fact.",
    );
    expect(screen.getByRole("region", { name: "새 버전" })).toHaveTextContent(
      /버전 1에서 시작해요/,
    );

    cleanup();
    await ai({ plan: "pro", write: "2" });
    expect(screen.getByRole("textbox", { name: "프롬프트" })).toHaveValue(
      "Prompt v8.\nName the rule.",
    );
  });
});

describe("AI's results", () => {
  it("lists each configuration's 30 days, marking what serves now and what is under test, red over 5%", async () => {
    admin.configurationResults.set(30, [
      result(haiku, 1, { calls: 40, ok: 37, no_cards: 1, model_error: 2, failure_rate: 0.05 }),
      result(haiku, 2, {
        calls: 10,
        ok: 8,
        invalid_output: 1,
        model_error: 1,
        failure_rate: 0.2,
      }),
      result("openai/gpt-old", 1, { calls: 0, unrecorded: 3 }),
    ]);
    await ai();
    expect(cells("결과 · 30일 (구성별)")).toEqual([
      [
        `OpenRouter · ${haiku} · v1 (사용 중)`,
        "호출 40",
        "카드 없음 1",
        "형식 오류 0",
        "모델 오류 2",
        "실패율 5.0%",
      ],
      [
        `OpenRouter · ${haiku} · v2 (테스트)`,
        "호출 10",
        "카드 없음 0",
        "형식 오류 1",
        "모델 오류 1",
        "실패율 20.0%",
      ],
      [
        "OpenRouter · openai/gpt-old · v1",
        "호출 0",
        "카드 없음 0",
        "형식 오류 0",
        "모델 오류 0",
        "실패율 기록 없음",
      ],
    ]);
    const table = within(screen.getByRole("table", { name: "결과 · 30일 (구성별)" }));
    expect(table.getByText("20.0%")).toHaveClass("text-dont-know-text");
    // Control: 5.0% is not over the line.
    expect(table.getByText("5.0%")).not.toHaveClass("text-dont-know-text");
    expect(admin.calls).toContain('admin_configuration_results {"days":30}');
  });

  it("says when nothing was recorded", async () => {
    await ai();
    expect(
      screen.getByText("최근 30일에 기록된 추출이 없어요. 사진으로 카드를 만들면 여기에 쌓여요."),
    ).toBeInTheDocument();
  });

  it("says it could not read a rate that disagrees with its calls, against one that agrees", async () => {
    admin.configurationResults.set(30, [result(haiku, 1, { calls: 0, failure_rate: 0 })]);
    await ai();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "받은 답을 읽지 못했어요. 페이지를 새로 고친 뒤 다시 시도해 주세요.",
    );

    // Control: no calls and no rate are read.
    cleanup();
    admin.configurationResults.set(30, [result(haiku, 1, { calls: 0, failure_rate: null })]);
    await ai();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("AI", () => {
  it("says a user who is not an admin may not see it", async () => {
    await signIn(otherUser);
    await ai();
    expect(screen.getByRole("alert")).toHaveTextContent("관리자만 볼 수 있어요.");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("says it could not load when the server fails, with a way to try again", async () => {
    server.use(
      http.post(`${supabaseUrl}/rest/v1/rpc/admin_configuration_results`, () =>
        HttpResponse.json({ code: "P0001", message: "boom" }, { status: 400 }),
      ),
    );
    await ai();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
    );
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });

  it("breaks no word inside, and keeps a model id whole, as the panel's facts do", async () => {
    await ai();
    expect(document.querySelectorAll(".break-all")).toHaveLength(0);
    const table = within(screen.getByRole("table", { name: "요금제별 사용 중인 구성" }));
    for (const model of table.getAllByText(haiku)) expect(model).toHaveClass("inline-block");
    const panel = within(screen.getByRole("region", { name: "프로 · 초안 (관리자만 테스트 중)" }));
    expect(panel.getByText(haiku)).toHaveClass("inline-block");
  });
});
