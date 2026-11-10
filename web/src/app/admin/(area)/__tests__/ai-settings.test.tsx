import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  activateAiConfiguration,
  clearAiTest,
  removeProviderKey,
  saveAiConfiguration,
  saveProviderKey,
  tryAiConfiguration,
} from "@/features/admin/actions";
import { FakeAdmin } from "@/testing/mocks/admin";
import { bearerUser, otherUser, supabaseUrl, testUser } from "@/testing/mocks/handlers";
import { server } from "@/testing/mocks/server";
import { setRequestCookies } from "@/testing/next-headers";
import { render } from "@/testing/render";
import { signedInCookies } from "@/testing/session";

import { AdminsContent, AiContent } from "../_components/content";

vi.mock("next/headers", () => import("@/testing/next-headers"));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => "/ai",
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
// The browser's canvas, which jsdom lacks, downscales the photo; here it passes through.
vi.mock("@/features/admin/encode-photo", () => ({
  encodePhoto: (file: File) => Promise.resolve(file),
}));

const KEY = "sk-new-openai-key-7777";

async function signIn(user: typeof testUser | typeof otherUser = testUser) {
  setRequestCookies([...(await signedInCookies(user)), { name: "smartman-tz", value: "UTC" }]);
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

let admin: FakeAdmin;
/** What the fake provider answers extract-cards' check call: a parsed reply, or why it failed. */
let check: "parsed" | "key_refused" | "model_not_found";
/** Every request to extract-cards, with its route and body. */
let sent: { route: string; user: string | null; body: Record<string, unknown> }[];

/** AI as the address [params] opens it. */
const ai = (params: Record<string, string> = {}) =>
  render(AiContent, { searchParams: Promise.resolve(params) });

/**
 * extract-cards with a fake provider: its settings routes save only after the check call parsed,
 * and a key only for an admin who signed in recently, as `settings.ts` does; a configuration as the
 * plan's one draft with the prompt version named, or else its draft's or its active one's, and
 * none for a version that does not exist; its extraction answers the configuration named, as
 * begin_extraction serves it.
 */
function fakeFunction() {
  server.use(
    http.post(`${supabaseUrl}/functions/v1/extract-cards/settings/:route`, async (info) => {
      const body = (await info.request.json()) as Record<string, unknown>;
      const route = String(info.params.route);
      const user = bearerUser(info.request.headers.get("authorization"))?.id ?? null;
      sent.push({ route, user, body });
      if (user === null || !admin.admins.has(user)) {
        return HttpResponse.json({ error: "forbidden" }, { status: 403 });
      }
      if (route === "key" && !admin.recentSignIn) {
        return HttpResponse.json({ error: "reauth" }, { status: 403 });
      }
      if (check !== "parsed") return HttpResponse.json({ error: check }, { status: 422 });
      if (route === "key") {
        admin.providerKeys.set(String(body.provider), {
          lastFour: String(body.key).slice(-4),
          setBy: user,
        });
        return HttpResponse.json({ saved: true });
      }
      const id = Math.max(...admin.aiConfigurations.map((entry) => entry.id)) + 1;
      const draft = admin.aiConfigurations.findIndex(
        (entry) => entry.plan === body.plan && entry.label === "test",
      );
      const kept = (
        admin.aiConfigurations[draft] ??
        admin.aiConfigurations.find((entry) => entry.plan === body.plan)
      )?.prompt_version_id;
      const prompt = body.prompt_version_id ?? kept;
      if (!admin.prompts.some((version) => version.id === prompt)) {
        return HttpResponse.json({ error: "bad_request" }, { status: 400 });
      }
      if (draft >= 0) admin.aiConfigurations.splice(draft, 1);
      admin.aiConfigurations.push({
        id,
        plan: String(body.plan),
        label: "test",
        provider: String(body.provider),
        model: String(body.model),
        prompt_version_id: Number(prompt),
        created_by: user,
      });
      return HttpResponse.json({ saved: true, configuration_id: id });
    }),
    http.post(`${supabaseUrl}/functions/v1/extract-cards`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      sent.push({ route: "extract", user: null, body });
      const served = admin.aiConfigurations.find((entry) => entry.id === body.configuration_id);
      return HttpResponse.json({
        cards: [{ front: "chat", back: `${served?.provider ?? "?"} ${served?.model ?? "?"}` }],
      });
    }),
  );
}

beforeEach(async () => {
  admin = new FakeAdmin();
  check = "parsed";
  sent = [];
  server.use(...admin.handlers);
  fakeFunction();
  await signIn();
});

describe("AI's provider keys", () => {
  it("shows each provider's key by its last four characters alone, OpenRouter without one unusable as every provider, and opens one key's form, its field empty, from the address", async () => {
    admin.providerKeys.set("anthropic", { lastFour: "3333", setBy: testUser.id });
    const { unmount } = await ai();
    const keys = within(screen.getByRole("list", { name: "제공자 키" }));
    const rows = keys.getAllByRole("listitem");
    // Each row holds the name, the state and its link, so a substring is right.
    expect(rows[0]).toHaveTextContent(/OpenRouter사용 중키 없음 · 이 제공자는 쓸 수 없어요/);
    expect(rows[1]).toHaveTextContent(/OpenAI키 없음 · 이 제공자는 쓸 수 없어요/);
    expect(rows[2]).toHaveTextContent(/Anthropic끝자리 3333 · .* · learner@example.com/);
    // No key form is laid out until the address opens one.
    expect(keys.queryByRole("form")).not.toBeInTheDocument();
    expect(
      keys.getAllByRole("link", { name: "키 저장" }).map((link) => link.getAttribute("href")),
    ).toEqual(["/ai?plan=free&key=openrouter", "/ai?plan=free&key=openai"]);
    expect(keys.getByRole("link", { name: "키 바꾸기" })).toHaveAttribute(
      "href",
      "/ai?plan=free&key=anthropic",
    );
    unmount();
    await ai({ key: "anthropic" });
    const opened = within(screen.getByRole("list", { name: "제공자 키" }));
    expect(opened.getAllByRole("form")).toHaveLength(1);
    const close = opened.getByRole("link", { name: "닫기" });
    expect(close).toHaveAttribute("href", "/ai?plan=free");
    // The key's actions share one size.
    expect(opened.getByRole("button", { name: "키 삭제" }).className).toBe(close.className);
    const anthropic = within(opened.getByRole("form", { name: "Anthropic 키" }));
    expect(anthropic.getByLabelText("새 키")).toHaveAttribute("type", "password");
    expect(anthropic.getByLabelText("새 키")).toHaveValue("");
    expect(anthropic.getByRole("textbox", { name: "확인할 모델" })).toHaveValue("claude-haiku-5-5");
  });

  it("stores a key only after the function's check call parsed, and never returns it", async () => {
    const save = () =>
      saveProviderKey(
        { message: null, reauth: false },
        form({ provider: "openai", key: KEY, model: "gpt-model" }),
      );
    check = "key_refused";
    expect(await save()).toEqual({
      message: "제공자가 이 키를 받지 않았어요. 키를 확인해 주세요.",
      reauth: false,
    });
    check = "model_not_found";
    expect((await save()).message).toBe("이 제공자에 없는 모델이에요. 모델 ID를 확인해 주세요.");
    expect(admin.providerKeys.has("openai"), "a key that fails is not stored").toBe(false);
    check = "parsed";
    const saved = await save();
    expect(saved).toEqual({ message: "키를 확인하고 저장했어요.", reauth: false });
    expect(JSON.stringify(saved)).not.toContain(KEY);
    expect(admin.providerKeys.get("openai")?.lastFour).toBe("7777");
    expect(sent.map((request) => request.body)).toContainEqual({
      provider: "openai",
      key: KEY,
      model: "gpt-model",
    });
  });

  it("asks an admin whose sign-in is older than 10 minutes to sign in again, and refuses a user who is not an admin before the function", async () => {
    admin.recentSignIn = false;
    const save = () =>
      saveProviderKey(
        { message: null, reauth: false },
        form({ provider: "openai", key: KEY, model: "gpt-model" }),
      );
    expect(await save()).toEqual({
      message: "보안을 위해 다시 로그인한 뒤 저장해 주세요.",
      reauth: true,
    });
    admin.recentSignIn = true;
    expect((await save()).reauth, "control: a recent sign-in saves").toBe(false);
    sent = [];
    await signIn(otherUser);
    expect(await save()).toEqual({ message: "관리자만 할 수 있어요.", reauth: false });
    expect(sent, "the function is not called").toEqual([]);
  });

  it("keeps a key an active configuration uses, and removes another after a recent sign-in", async () => {
    admin.providerKeys.set("openrouter", { lastFour: "1111", setBy: testUser.id });
    admin.providerKeys.set("openai", { lastFour: "2222", setBy: testUser.id });
    expect(await removeProviderKey("openrouter")).toEqual({
      changed: false,
      message: "사용 중인 키예요. 이 키를 쓰지 않는 설정을 먼저 적용해 주세요.",
    });
    admin.recentSignIn = false;
    expect((await removeProviderKey("openai")).message).toBe(
      "보안을 위해 다시 로그인한 뒤 삭제해 주세요.",
    );
    admin.recentSignIn = true;
    expect(await removeProviderKey("openai")).toEqual({
      changed: true,
      message: "키를 삭제했어요.",
    });
    expect([...admin.providerKeys.keys()]).toEqual(["openrouter"]);
  });
});

describe("a plan's draft: its provider, model and prompt saved after a check, tried by admins, applied to everyone", () => {
  it("saves a draft with the prompt version chosen, compares it with the active configuration on one photo, applies it and records each step", async () => {
    admin.providerKeys.set("anthropic", { lastFour: "3333", setBy: testUser.id });
    admin.prompts.push({ id: 2, text: "Prompt v9.", note: "", by: null });
    const save = (fields: Record<string, string>) =>
      saveAiConfiguration({ message: null, reauth: false }, form({ plan: "pro", ...fields }));
    check = "model_not_found";
    expect(
      (await save({ provider: "anthropic", model: "claude-missing", prompt_version_id: "2" }))
        .message,
    ).toBe("이 제공자에 없는 모델이에요. 모델 ID를 확인해 주세요.");
    expect(admin.aiConfigurations.some((entry) => entry.label === "test")).toBe(false);

    check = "parsed";
    expect(
      await save({ provider: "anthropic", model: "claude-haiku-5-5", prompt_version_id: "2" }),
    ).toEqual({ message: "확인하고 초안으로 저장했어요. 관리자만 이 구성을 써요.", reauth: false });
    expect(sent.at(-1)?.body).toEqual({
      plan: "pro",
      provider: "anthropic",
      model: "claude-haiku-5-5",
      prompt_version_id: 2,
    });

    const user = userEvent.setup();
    await ai();
    const panel = within(screen.getByRole("region", { name: "플러스 · 초안 (관리자만 테스트 중)" }));
    expect(
      panel.getByRole("heading", {
        name: "제공자 OpenRouter → Anthropic · 모델 anthropic/claude-haiku-5.5 → claude-haiku-5-5 · 프롬프트 v1 → v2",
      }),
    ).toBeInTheDocument();
    const trial = within(panel.getByRole("region", { name: "플러스 사진 한 장으로 시험" }));
    await user.upload(
      trial.getByLabelText("사진"),
      new File([new Uint8Array([1, 2, 3])], "page.jpg", { type: "image/jpeg" }),
    );
    await user.click(trial.getByRole("button", { name: "시험하기" }));
    const draftCards = within(await trial.findByRole("region", { name: "초안" }));
    expect(draftCards.getByRole("heading", { name: "초안 · 카드 1장" })).toBeInTheDocument();
    expect(draftCards.getByText("anthropic claude-haiku-5-5")).toBeInTheDocument();
    const activeCards = within(trial.getByRole("region", { name: "지금 구성" }));
    expect(activeCards.getByRole("heading", { name: "지금 구성 · 카드 1장" })).toBeInTheDocument();
    expect(activeCards.getByText("openrouter anthropic/claude-haiku-5.5")).toBeInTheDocument();
    const tried = sent.filter((request) => request.route === "extract").map((r) => r.body);
    expect(tried.map((body) => body.configuration_id).sort()).toEqual([2, 5]);
    expect(tried.every((body) => body.image === "AQID")).toBe(true);

    await user.click(panel.getByRole("button", { name: "모두에게 적용" }));
    await user.click(panel.getByRole("button", { name: "취소" }));
    expect(admin.calls.some((call) => call.startsWith("admin_activate_ai_configuration"))).toBe(
      false,
    );
    await user.click(panel.getByRole("button", { name: "모두에게 적용" }));
    await user.click(panel.getByRole("button", { name: "적용" }));
    expect(await panel.findByText("모든 사용자에게 적용했어요.")).toBeInTheDocument();
    expect(admin.calls).toContain('admin_activate_ai_configuration {"plan":"pro"}');
    expect(
      admin.aiConfigurations
        .filter((entry) => entry.plan === "pro")
        .map((entry) => [entry.label, entry.prompt_version_id]),
    ).toEqual([["active", 2]]);
    await render(AdminsContent, {});
    expect(screen.getByRole("list", { name: "작업 기록" })).toHaveTextContent(
      /AI 설정 적용 · 플러스 · Anthropic · claude-haiku-5-5/,
    );
  });

  it("keeps the draft's prompt when the form names none, and refuses a version that is not one's id before the function", async () => {
    admin.prompts.push({ id: 2, text: "Prompt v9.", note: "", by: null });
    const save = (fields: Record<string, string>) =>
      saveAiConfiguration(
        { message: null, reauth: false },
        form({
          plan: "max",
          provider: "openrouter",
          model: "anthropic/claude-haiku-5.5",
          ...fields,
        }),
      );
    expect((await save({ prompt_version_id: "abc" })).message).toBe(
      "하지 못했어요. 잠시 후 다시 시도해 주세요.",
    );
    expect(sent, "the function is not called").toEqual([]);
    await save({ prompt_version_id: "2" });
    await save({});
    expect(sent.map((request) => request.body.prompt_version_id)).toEqual([2, undefined]);
    expect(admin.aiConfigurations.find((entry) => entry.label === "test")?.prompt_version_id).toBe(
      2,
    );
    // A version the server does not know is refused there.
    expect((await save({ prompt_version_id: "9" })).message).toBe(
      "하지 못했어요. 잠시 후 다시 시도해 주세요.",
    );
  });

  it("refuses to apply a draft whose provider has no key, and ends a draft once asked", async () => {
    await saveAiConfiguration(
      { message: null, reauth: false },
      form({ plan: "max", provider: "openai", model: "gpt-model" }),
    );
    expect(await activateAiConfiguration("max")).toEqual({
      changed: false,
      message: "이 제공자의 키가 없어 적용할 수 없어요.",
    });
    const user = userEvent.setup();
    await ai({ plan: "max" });
    const panel = within(screen.getByRole("region", { name: "프로 · 초안 (관리자만 테스트 중)" }));
    await user.click(panel.getByRole("button", { name: "테스트 끝내기" }));
    await user.click(panel.getByRole("button", { name: "끝내기" }));
    expect(
      await panel.findByText("테스트를 끝냈어요. 관리자도 사용 중인 설정을 써요."),
    ).toBeInTheDocument();
    expect(admin.calls).toContain('admin_clear_ai_test {"plan":"max"}');
    expect(await clearAiTest("max")).toEqual({
      changed: false,
      message: "테스트 중인 설정이 없어요.",
    });
    expect(await activateAiConfiguration("max")).toEqual({
      changed: false,
      message: "테스트 중인 설정이 없어요.",
    });
  });

  it("shows 스페셜 like any plan, and saves, applies and ends its draft, refusing a plan that does not exist", async () => {
    await ai({ plan: "special" });
    const special = within(screen.getByRole("region", { name: "스페셜 · 사용 중인 구성" }));
    expect(
      special.getByRole("heading", {
        name: "OpenRouter · anthropic/claude-haiku-5.5 · 프롬프트 v1",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "스페셜 · 사용 중인 구성" })).not.toHaveTextContent(
      "숨김",
    );

    admin.providerKeys.set("anthropic", { lastFour: "3333", setBy: testUser.id });
    expect(
      await saveAiConfiguration(
        { message: null, reauth: false },
        form({ plan: "special", provider: "anthropic", model: "claude-haiku-5-5" }),
      ),
    ).toEqual({ message: "확인하고 초안으로 저장했어요. 관리자만 이 구성을 써요.", reauth: false });
    expect(await activateAiConfiguration("special")).toEqual({
      changed: true,
      message: "모든 사용자에게 적용했어요.",
    });
    expect(await clearAiTest("special")).toEqual({
      changed: false,
      message: "테스트 중인 설정이 없어요.",
    });

    const sentBefore = sent.length;
    expect(
      (
        await saveAiConfiguration(
          { message: null, reauth: false },
          form({ plan: "gold", provider: "anthropic", model: "claude-haiku-5-5" }),
        )
      ).message,
    ).toBe("하지 못했어요. 잠시 후 다시 시도해 주세요.");
    expect(await activateAiConfiguration("gold")).toMatchObject({ changed: false });
    expect(sent).toHaveLength(sentBefore);
  });

  it("refuses the trial to a user who is not an admin before the function is called, and an admin's reaches it", async () => {
    const data = new FormData();
    data.set("photo", new File([new Uint8Array([1])], "page.jpg", { type: "image/jpeg" }));
    await signIn(otherUser);
    expect(await tryAiConfiguration(5, 2, data)).toEqual({ message: "관리자만 할 수 있어요." });
    expect(sent).toEqual([]);
    await signIn();
    expect(await tryAiConfiguration(5, 2, data)).toMatchObject({ active: { cards: [{}] } });
    expect(sent.map((request) => request.body.configuration_id).sort()).toEqual([2, 5]);
  });

  it("refuses a model id of another provider's form before the function is called", async () => {
    expect(
      (
        await saveAiConfiguration(
          { message: null, reauth: false },
          form({ plan: "pro", provider: "openrouter", model: "claude-haiku-5-5" }),
        )
      ).message,
    ).toBe("모델 ID는 vendor/model 꼴로 적어 주세요.");
    expect(sent).toEqual([]);
    await saveAiConfiguration(
      { message: null, reauth: false },
      form({ plan: "pro", provider: "anthropic", model: "claude-haiku-5-5" }),
    );
    expect(sent, "control: a model id of the provider's form is checked").toHaveLength(1);
  });
});
