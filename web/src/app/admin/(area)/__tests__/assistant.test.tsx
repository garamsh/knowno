import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  activateAssistantConfiguration,
  clearAssistantTest,
  saveAssistantConfiguration,
  saveAssistantPrompt,
  setAssistantTokenBudget,
} from "@/features/admin/actions";
import { FakeAdmin } from "@/testing/mocks/admin";
import { bearerUser, otherUser, supabaseUrl, testUser } from "@/testing/mocks/handlers";
import { server } from "@/testing/mocks/server";
import { setRequestCookies } from "@/testing/next-headers";
import { redirectTarget } from "@/testing/redirect";
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

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

let admin: FakeAdmin;
/** What the fake provider answers the assistant's check call: parsed, or why it failed. */
let check: "parsed" | "key_refused" | "model_not_found" | "effort_unsupported";
/** Every request to the assistant's settings route, with its caller and body. */
let sent: { user: string | null; body: Record<string, unknown> }[];

/** 말랑이 as the address [params] opens it. */
const assistant = (params: Record<string, string> = {}) =>
  render(AssistantContent, { searchParams: Promise.resolve(params) });

/**
 * The assistant's `settings/configuration` route with a fake provider, as extract-cards' saves a
 * photo draft: for an admin, after the check call parsed, the body becomes the plan's one draft;
 * a prompt version that does not exist is refused.
 */
function fakeRoute() {
  server.use(
    http.post(`${supabaseUrl}/functions/v1/assistant/settings/configuration`, async (info) => {
      const body = (await info.request.json()) as Record<string, unknown>;
      const user = bearerUser(info.request.headers.get("authorization"))?.id ?? null;
      sent.push({ user, body });
      if (user === null || !admin.admins.has(user)) {
        return HttpResponse.json({ error: "forbidden" }, { status: 403 });
      }
      if (check === "effort_unsupported") {
        return HttpResponse.json({ error: check }, { status: 400 });
      }
      if (check !== "parsed") return HttpResponse.json({ error: check }, { status: 422 });
      if (!admin.assistantPrompts.some((prompt) => prompt.id === body.prompt_version_id)) {
        return HttpResponse.json({ error: "bad_request" }, { status: 400 });
      }
      const id = Math.max(...admin.assistantConfigurations.map((entry) => entry.id)) + 1;
      const draft = admin.assistantConfigurations.findIndex(
        (entry) => entry.plan === body.plan && entry.label === "test",
      );
      if (draft >= 0) admin.assistantConfigurations.splice(draft, 1);
      admin.assistantConfigurations.push({
        id,
        plan: String(body.plan),
        label: "test",
        provider: String(body.provider),
        model: String(body.model),
        prompt_version_id: Number(body.prompt_version_id),
        created_by: user,
        web_search: body.web_search === true,
        max_searches: Number(body.max_searches),
        reasoning_effort: String(body.reasoning_effort),
      });
      return HttpResponse.json({ saved: true, configuration_id: id });
    }),
  );
}

/** A full draft form for [plan], as the browser posts it, with [fields] over its defaults. */
function draftForm(plan: string, fields: Record<string, string> = {}): FormData {
  return form({
    plan,
    provider: "openrouter",
    model: "anthropic/claude-haiku-5.5",
    prompt_version_id: "2",
    web_search: "on",
    max_searches: "5",
    reasoning_effort: "medium",
    ...fields,
  });
}

/** Pro's draft: its active provider and model on prompt v2, without web search, reasoning low. */
function seedDraft() {
  admin.assistantConfigurations.push({
    id: 9,
    plan: "pro",
    label: "test",
    provider: "openrouter",
    model: "anthropic/claude-haiku-5.5",
    prompt_version_id: 2,
    created_by: testUser.id,
    web_search: false,
    max_searches: 3,
    reasoning_effort: "low",
  });
}

beforeEach(async () => {
  admin = new FakeAdmin();
  admin.assistantPrompts.push({
    id: 2,
    text: "You are 말랑이.\nAnswer briefly.\nAsk before a long list.",
    note: "asks first",
    by: testUser.id,
  });
  check = "parsed";
  sent = [];
  server.use(...admin.handlers);
  fakeRoute();
  await signIn();
});

describe("말랑이's plans", () => {
  it("lists each plan's active configuration with its web search, reasoning and daily token budget, and its draft", async () => {
    seedDraft();
    await assistant();
    const table = within(screen.getByRole("table", { name: "요금제별 사용 중인 구성" }));
    const rows = table.getAllByRole("row").slice(1);
    // Each row's text joins its cells, each named as below 1024 px.
    const cells = (plan: string, search: string, budget: string, draft: string, action: string) =>
      `${plan}제공자 OpenRouter모델 anthropic/claude-haiku-5.5프롬프트 v1웹 검색 ${search}추론 없음하루 토큰 ${budget}초안 ${draft}${action}`;
    expect(rows.map((entry) => entry.textContent)).toEqual([
      cells("무료", "끔", "200,000", "—", "바꾸기"),
      cells("프로", "메시지당 3회", "2,000,000", "테스트 중", "초안 보기"),
      cells("맥스", "메시지당 3회", "6,000,000", "—", "바꾸기"),
      cells("스페셜", "메시지당 3회", "제한 없음", "—", "바꾸기"),
    ]);
    expect(table.getByRole("link", { name: "초안 보기" })).toHaveAttribute(
      "href",
      "/assistant?plan=pro",
    );
    // The message limit's functions are gone; the page reads the budgets.
    expect(admin.calls.map((call) => call.split(" ")[0])).toContain(
      "admin_assistant_token_budgets",
    );
    expect(admin.calls.some((call) => call.includes("assistant_limit"))).toBe(false);
  });

  it("opens the first plan with a draft, names what it changes, shows its prompt's lines, and starts the form from it", async () => {
    seedDraft();
    await assistant();
    const panel = within(screen.getByRole("region", { name: "프로 · 초안 (관리자만 테스트 중)" }));
    expect(
      panel.getByRole("heading", {
        name: "제공자·모델 그대로 · 프롬프트 v1 → v2 · 웹 검색 메시지당 3회 → 끔 · 추론 없음 → 낮음",
      }),
    ).toBeInTheDocument();
    expect(panel.getByText("프롬프트 v1 → v2 다른 점")).toBeInTheDocument();
    expect(panel.getByText("Ask before a long list.")).toBeInTheDocument();
    expect(panel.getByRole("button", { name: "모두에게 적용" })).toBeInTheDocument();
    const draft = within(panel.getByRole("form", { name: "프로 새 초안" }));
    expect(draft.getByRole("combobox", { name: "제공자" })).toHaveValue("openrouter");
    expect(draft.getByRole("textbox", { name: "모델" })).toHaveValue("anthropic/claude-haiku-5.5");
    expect(draft.getByRole("combobox", { name: "프롬프트" })).toHaveValue("2");
    expect(draft.getByRole("checkbox", { name: "웹 검색" })).not.toBeChecked();
    expect(draft.getByRole("spinbutton", { name: "메시지당 검색" })).toHaveValue(3);
    expect(draft.getByRole("combobox", { name: "추론" })).toHaveValue("low");
  });

  it("opens the plan the address names, without a draft its active configuration and no action", async () => {
    seedDraft();
    await assistant({ plan: "max" });
    const panel = within(screen.getByRole("region", { name: "맥스 · 사용 중인 구성" }));
    expect(
      panel.getByRole("heading", {
        name: "OpenRouter · anthropic/claude-haiku-5.5 · 프롬프트 v1 · 웹 검색 메시지당 3회 · 추론 없음",
      }),
    ).toBeInTheDocument();
    expect(panel.queryByRole("button", { name: "모두에게 적용" })).toBeNull();
    expect(
      within(panel.getByRole("form", { name: "맥스 새 초안" })).getByRole("checkbox", {
        name: "웹 검색",
      }),
    ).toBeChecked();
  });

  it("says what failed for a reader who is not an admin", async () => {
    await signIn(otherUser);
    await assistant();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("관리자만 볼 수 있어요.")).toBeInTheDocument();
  });
});

describe("an assistant draft: saved after the assistant's check, applied to everyone or ended", () => {
  it("posts every setting to the assistant's settings route, saving only once its check parsed", async () => {
    check = "model_not_found";
    expect(
      (await saveAssistantConfiguration({ message: null, reauth: false }, draftForm("pro")))
        .message,
    ).toBe("이 제공자에 없는 모델이에요. 모델 ID를 확인해 주세요.");
    check = "effort_unsupported";
    expect(
      (await saveAssistantConfiguration({ message: null, reauth: false }, draftForm("pro")))
        .message,
    ).toBe("이 모델은 고른 추론 수준으로 쓸 수 없어요. 추론을 바꿔 주세요.");
    expect(admin.assistantConfigurations.some((entry) => entry.label === "test")).toBe(false);

    check = "parsed";
    expect(
      await saveAssistantConfiguration({ message: null, reauth: false }, draftForm("pro")),
    ).toEqual({
      message: "확인하고 초안으로 저장했어요. 관리자만 이 구성을 써요.",
      reauth: false,
    });
    expect(sent.at(-1)).toEqual({
      user: testUser.id,
      body: {
        plan: "pro",
        provider: "openrouter",
        model: "anthropic/claude-haiku-5.5",
        prompt_version_id: 2,
        web_search: true,
        max_searches: 5,
        reasoning_effort: "medium",
      },
    });
    // An unchecked box is absent from the form, and saved as search off.
    await saveAssistantConfiguration(
      { message: null, reauth: false },
      draftForm("pro", { web_search: "" }),
    );
    expect(sent.at(-1)?.body.web_search).toBe(false);
    expect(
      admin.assistantConfigurations
        .filter((entry) => entry.plan === "pro")
        .map((entry) => [entry.label, entry.prompt_version_id, entry.web_search]),
    ).toEqual([
      ["active", 1, true],
      ["test", 2, false],
    ]);
  });

  it("refuses a malformed effort, a search count outside 1 to 10, a model of another provider's form and a user who is not an admin before the route, and sends the same form once each is fixed", async () => {
    const save = (data: FormData) =>
      saveAssistantConfiguration({ message: null, reauth: false }, data);
    expect((await save(draftForm("pro", { reasoning_effort: "max" }))).message).toBe(
      "하지 못했어요. 잠시 후 다시 시도해 주세요.",
    );
    expect((await save(draftForm("pro", { max_searches: "11" }))).message).toBe(
      "검색 횟수는 1에서 10 사이로 적어 주세요.",
    );
    expect((await save(draftForm("pro", { model: "claude-haiku-5-5" }))).message).toBe(
      "모델 ID는 vendor/model 꼴로 적어 주세요.",
    );
    expect((await save(draftForm("gold"))).message).toBe(
      "하지 못했어요. 잠시 후 다시 시도해 주세요.",
    );
    await signIn(otherUser);
    expect((await save(draftForm("pro"))).message).toBe("관리자만 할 수 있어요.");
    expect(sent, "the route is not called").toEqual([]);
    // Control: the same forms with the one field fixed reach the route.
    await signIn();
    await save(draftForm("pro", { max_searches: "10" }));
    await save(draftForm("pro", { provider: "anthropic", model: "claude-haiku-5-5" }));
    expect(sent.map((request) => request.body.max_searches)).toEqual([10, 5]);
  });

  it("applies the draft once asked, refuses one whose provider has no key, ends one, and records each", async () => {
    seedDraft();
    const user = userEvent.setup();
    await assistant();
    const panel = within(screen.getByRole("region", { name: "프로 · 초안 (관리자만 테스트 중)" }));
    await user.click(panel.getByRole("button", { name: "모두에게 적용" }));
    await user.click(panel.getByRole("button", { name: "취소" }));
    expect(admin.calls.some((call) => call.startsWith("admin_activate_assistant"))).toBe(false);
    await user.click(panel.getByRole("button", { name: "모두에게 적용" }));
    await user.click(panel.getByRole("button", { name: "적용" }));
    expect(await panel.findByText("모든 사용자에게 적용했어요.")).toBeInTheDocument();
    expect(admin.calls).toContain('admin_activate_assistant_configuration {"plan":"pro"}');
    expect(
      admin.assistantConfigurations
        .filter((entry) => entry.plan === "pro")
        .map((entry) => [entry.label, entry.prompt_version_id]),
    ).toEqual([["active", 2]]);

    await saveAssistantConfiguration(
      { message: null, reauth: false },
      draftForm("max", { provider: "anthropic", model: "claude-haiku-5-5" }),
    );
    expect(await activateAssistantConfiguration("max")).toEqual({
      changed: false,
      message: "이 제공자의 키가 없어 적용할 수 없어요.",
    });
    expect(await clearAssistantTest("max")).toEqual({
      changed: true,
      message: "테스트를 끝냈어요. 관리자도 사용 중인 설정을 써요.",
    });
    expect(await clearAssistantTest("max")).toEqual({
      changed: false,
      message: "테스트 중인 설정이 없어요.",
    });
    expect(await activateAssistantConfiguration("gold")).toMatchObject({ changed: false });

    await render(AdminsContent, {});
    const log = within(screen.getByRole("list", { name: "작업 기록" }));
    expect(log.getAllByRole("listitem").map((entry) => entry.firstChild?.textContent)).toEqual([
      "말랑이 설정 테스트 끝 · 맥스",
      "말랑이 설정 적용 · 프로",
    ]);
    expect(log.getByRole("link", { name: "프로" })).toHaveAttribute("href", "/assistant?plan=pro");
  });
});

describe("말랑이's prompt versions", () => {
  it("lists every version with its labels, and opens the new version's form from the active one or the one named", async () => {
    seedDraft();
    const { unmount } = await assistant({ plan: "pro" });
    const versions = within(screen.getByRole("list", { name: "프롬프트 버전" }));
    // Each row holds the version, its labels and its day, so a substring is right.
    expect(versions.getAllByRole("link").map((link) => link.textContent)).toEqual([
      expect.stringMatching(/^v2 · 초안에서 사용 · .*asks first$/),
      expect.stringMatching(/^v1 · 사용 중 · .*first$/),
    ]);
    expect(versions.getAllByRole("link")[1]).toHaveAttribute("href", "/assistant?plan=pro&write=1");
    expect(screen.getByRole("link", { name: "새 버전 쓰기" })).toHaveAttribute(
      "href",
      "/assistant?plan=pro&write=",
    );
    expect(screen.queryByRole("form", { name: "새 버전" })).toBeNull();
    unmount();

    await assistant({ plan: "pro", write: "" });
    expect(screen.getByRole("textbox", { name: /프롬프트/ })).toHaveValue(
      "You are 말랑이.\nAnswer briefly.",
    );
    expect(screen.getByText(/^버전 1에서 시작해요/)).toBeInTheDocument();
  });

  it("saves a version that serves no one, records it and returns to 말랑이, refusing a blank text and a user who is not an admin", async () => {
    expect(
      (await saveAssistantPrompt({ message: null }, form({ text: " \n ", note: "" }))).message,
    ).toBe("프롬프트를 2만 자 안으로 적어 주세요.");
    await signIn(otherUser);
    expect(await saveAssistantPrompt({ message: null }, form({ text: "Mine.", note: "" }))).toEqual(
      { message: "관리자만 할 수 있어요." },
    );
    expect(admin.assistantPrompts).toHaveLength(2);
    await signIn();
    expect(
      await redirectTarget(
        saveAssistantPrompt({ message: null }, form({ text: "Third.", note: " try " })),
      ),
    ).toBe("/assistant");
    expect(admin.assistantPrompts.at(-1)).toEqual({
      id: 3,
      text: "Third.",
      note: "try",
      by: testUser.id,
    });
    expect(admin.prompts, "the photo prompts are untouched").toHaveLength(1);
    expect(admin.assistantConfigurations.map((entry) => entry.prompt_version_id)).toEqual([
      1, 1, 1, 1,
    ]);
    await render(AdminsContent, {});
    expect(screen.getByRole("link", { name: "버전 3" })).toHaveAttribute("href", "/assistant");
  });
});

describe("a plan's daily token budget", () => {
  it("shows the plan's budget, sets a new one or none from its form, records each, and refuses one out of range before the server", async () => {
    const user = userEvent.setup();
    await assistant({ plan: "pro" });
    const section = within(screen.getByRole("region", { name: "프로 · 하루 토큰 예산" }));
    expect(section.getByText("하루 2,000,000토큰")).toBeInTheDocument();
    const budget = within(section.getByRole("form", { name: "프로 하루 토큰 예산" }));
    expect(budget.getByRole("spinbutton", { name: "하루 토큰" })).toHaveValue(2_000_000);
    expect(budget.getByRole("checkbox", { name: "제한 없음" })).not.toBeChecked();
    await user.clear(budget.getByRole("spinbutton", { name: "하루 토큰" }));
    await user.type(budget.getByRole("spinbutton", { name: "하루 토큰" }), "3000000");
    await user.click(budget.getByRole("button", { name: "예산 저장" }));
    expect(
      await section.findByText("하루 토큰 예산을 바꿨어요. 다음 메시지부터 적용돼요."),
    ).toBeInTheDocument();
    expect(admin.assistantTokenBudgets.get("pro")).toBe(3_000_000);

    const set = (fields: Record<string, string>) =>
      setAssistantTokenBudget({ message: null }, form({ plan: "max", ...fields }));
    expect(await set({ daily_tokens: "6000000" })).toEqual({ message: "지금 예산과 같아요." });
    expect(await set({ daily_tokens: "1000000001" })).toEqual({
      message: "토큰 수는 0에서 10억 사이로 적어 주세요.",
    });
    expect(await set({ daily_tokens: "-1" })).toEqual({
      message: "토큰 수는 0에서 10억 사이로 적어 주세요.",
    });
    expect(
      admin.calls.filter((call) => call.startsWith("admin_set_assistant_token_budget")),
    ).toEqual([
      'admin_set_assistant_token_budget {"plan":"pro","daily_tokens":3000000}',
      'admin_set_assistant_token_budget {"plan":"max","daily_tokens":6000000}',
    ]);
    // Control: the largest budget, and none, reach the server.
    expect((await set({ daily_tokens: "1000000000" })).message).toBe(
      "하루 토큰 예산을 바꿨어요. 다음 메시지부터 적용돼요.",
    );
    expect((await set({ daily_tokens: "", none: "on" })).message).toBe(
      "하루 토큰 예산을 바꿨어요. 다음 메시지부터 적용돼요.",
    );
    expect(admin.assistantTokenBudgets.get("max")).toBeNull();
    await signIn(otherUser);
    expect(await set({ daily_tokens: "5" })).toEqual({ message: "관리자만 할 수 있어요." });
    expect(admin.assistantTokenBudgets.get("max")).toBeNull();

    await signIn();
    await render(AdminsContent, {});
    expect(
      within(screen.getByRole("list", { name: "작업 기록" }))
        .getAllByRole("listitem")
        .map((entry) => entry.firstChild?.textContent),
    ).toEqual([
      "말랑이 하루 토큰 예산 · 맥스 · 제한 없음",
      "말랑이 하루 토큰 예산 · 맥스 · 하루 1,000,000,000토큰",
      "말랑이 하루 토큰 예산 · 프로 · 하루 3,000,000토큰",
    ]);
  });
});
