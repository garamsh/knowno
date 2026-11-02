import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  activatePrompt,
  clearTestPrompt,
  savePrompt,
  testPrompt,
  tryPrompt,
} from "@/features/admin/actions";
import { FakeAdmin } from "@/testing/mocks/admin";
import { bearerUser, otherUser, supabaseUrl, testUser } from "@/testing/mocks/handlers";
import { server } from "@/testing/mocks/server";
import { setRequestCookies } from "@/testing/next-headers";
import { render } from "@/testing/render";
import { signedInCookies } from "@/testing/session";
import { field } from "@/supabase/row";

import { AiContent, AuditContent, NewPromptContent, PromptContent } from "../_components/content";

vi.mock("next/headers", () => import("@/testing/next-headers"));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => "/admin/ai",
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
// The browser's canvas, which jsdom lacks, downscales the photo; here it passes through, and a
// file named "unreadable.jpg" stands for one the browser cannot decode.
vi.mock("@/features/admin/encode-photo", () => ({
  encodePhoto: (file: File) => Promise.resolve(file.name === "unreadable.jpg" ? null : file),
}));

const notFound = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };

async function signIn(user: typeof testUser | typeof otherUser = testUser) {
  setRequestCookies([...(await signedInCookies(user)), { name: "smartman-tz", value: "UTC" }]);
}

/** extract-cards, which answers [answer] and records who called it with which image. */
function extractCards(answer: () => Response) {
  const calls: { user: string | null; image: unknown }[] = [];
  server.use(
    http.post(`${supabaseUrl}/functions/v1/extract-cards`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      calls.push({
        user: bearerUser(request.headers.get("authorization"))?.id ?? null,
        image: body.image,
      });
      return answer();
    }),
  );
  return calls;
}

/** Where [action] redirected, read from the error Next's `redirect` throws, or "" when it did not. */
async function redirected(action: Promise<unknown>): Promise<string> {
  try {
    await action;
  } catch (error) {
    const digest = field(error, "digest");
    if (typeof digest === "string") return digest;
    throw error;
  }
  return "";
}

/** A form of [fields], as the browser posts it. */
function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

let admin: FakeAdmin;
beforeEach(async () => {
  admin = new FakeAdmin();
  admin.prompts.push({
    id: 2,
    text: "Prompt v8.\nKeep each fact once.",
    note: "shorter",
    by: testUser.id,
  });
  server.use(...admin.handlers);
  await signIn();
});

describe("사진 AI's versions and the new version's form", () => {
  it("lists the versions newest first with their labels, and starts the form from the active one", async () => {
    await render(AiContent, {});
    const versions = within(screen.getByRole("region", { name: "버전별 결과" }));
    expect(versions.getAllByRole("link").map((link) => link.textContent)).toEqual([
      expect.stringMatching(/^버전 2shorter/),
      expect.stringMatching(/^버전 1사용 중prompt v8/),
    ]);
    expect(screen.getByText(/사용 중인 버전 1로 카드를 만들어요/)).toBeInTheDocument();

    cleanup();
    await render(NewPromptContent, { searchParams: Promise.resolve({}) });
    expect(screen.getByRole("textbox", { name: "프롬프트" })).toHaveValue(
      "Prompt v8.\nKeep each fact.",
    );
  });

  it("starts the form from the version the address names", async () => {
    await render(NewPromptContent, { searchParams: Promise.resolve({ from: "2" }) });
    expect(screen.getByRole("textbox", { name: "프롬프트" })).toHaveValue(
      "Prompt v8.\nKeep each fact once.",
    );
  });
});

describe("saving a version", () => {
  it("saves the text as a new version that serves no one, records it, and opens it", async () => {
    expect(
      await redirected(savePrompt({ message: null }, form({ text: "New prompt.", note: " try " }))),
    ).toContain(";/admin/ai/3;");
    expect(admin.prompts.at(-1)).toEqual({
      id: 3,
      text: "New prompt.",
      note: "try",
      by: testUser.id,
    });
    expect(admin.promptLabels.get("active")).toBe(1);
    expect(admin.audit.map((entry) => entry.action)).toEqual(["save_prompt"]);
  });

  it("refuses a blank text, one over 20,000 characters and a long note without asking the server", async () => {
    for (const fields of [
      { text: " \n ", note: "" },
      { text: "가".repeat(20_001), note: "" },
      { text: "ok", note: "n".repeat(201) },
    ]) {
      expect((await savePrompt({ message: null }, form(fields))).message).not.toBeNull();
    }
    expect(admin.calls).toEqual([]);
    // Control: 20,000 characters are saved.
    expect(
      await redirected(
        savePrompt({ message: null }, form({ text: "가".repeat(20_000), note: "" })),
      ),
    ).toContain(";/admin/ai/3;");
  });

  it("is refused for a user who is not an admin, saving nothing, and done for an admin", async () => {
    await signIn(otherUser);
    expect(await savePrompt({ message: null }, form({ text: "Mine.", note: "" }))).toEqual({
      message: "관리자만 할 수 있어요.",
    });
    expect(admin.prompts).toHaveLength(2);
    await signIn();
    expect(
      await redirected(savePrompt({ message: null }, form({ text: "Mine.", note: "" }))),
    ).toContain(";/admin/ai/3;");
  });
});

describe("a version's page", () => {
  it("shows the difference from the active version line by line, in words as well as colour", async () => {
    await render(PromptContent, {
      params: Promise.resolve({ id: "2" }),
      searchParams: Promise.resolve({}),
    });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("버전 2");
    const diff = within(screen.getByRole("region", { name: "사용 중인 버전과 다른 점" }));
    expect(
      diff.getByText("바뀐 줄 2개: 빼는 줄은 −, 더하는 줄은 +로 표시해요."),
    ).toBeInTheDocument();
    expect(diff.getAllByRole("listitem").map((line) => line.textContent)).toEqual([
      "Prompt v8.",
      "−뺌: Keep each fact.",
      "+더함: Keep each fact once.",
    ]);
  });

  it("serves the version to every user once confirmed, and rolls back to an earlier one the same way", async () => {
    const user = userEvent.setup();
    const view = await render(PromptContent, {
      params: Promise.resolve({ id: "2" }),
      searchParams: Promise.resolve({}),
    });
    await user.click(screen.getByRole("button", { name: "모든 사용자에게 적용" }));
    await user.click(screen.getByRole("button", { name: "취소" }));
    expect(admin.promptLabels.get("active")).toBe(1);
    await user.click(screen.getByRole("button", { name: "모든 사용자에게 적용" }));
    await user.click(screen.getByRole("button", { name: "적용" }));
    expect(await screen.findByText("이 버전을 모든 사용자에게 적용했어요.")).toBeInTheDocument();
    expect(admin.promptLabels.get("active")).toBe(2);

    view.unmount();
    await render(PromptContent, {
      params: Promise.resolve({ id: "1" }),
      searchParams: Promise.resolve({}),
    });
    expect(screen.getByRole("region", { name: "사용 중인 버전과 다른 점" })).toBeInTheDocument();
    expect(await activatePrompt(1)).toEqual({
      changed: true,
      message: "이 버전을 모든 사용자에게 적용했어요.",
    });
    expect(await activatePrompt(1)).toEqual({
      changed: false,
      message: "이미 사용 중인 버전이에요.",
    });
    expect(admin.promptLabels.get("active")).toBe(1);
  });

  it("serves a version to admins as the test version, which the trial then runs, and ends the test", async () => {
    expect(await testPrompt(2)).toMatchObject({ changed: true });
    await render(AiContent, {});
    expect(screen.getByText(/테스트 버전 2로 카드를 만들어요/)).toBeInTheDocument();
    expect(await clearTestPrompt()).toMatchObject({ changed: true });
    expect(await clearTestPrompt()).toEqual({
      changed: false,
      message: "테스트 중인 버전이 없어요.",
    });
    expect(admin.promptLabels.has("test")).toBe(false);
  });

  it("activating the test version ends the test, so admins follow the active one", async () => {
    await testPrompt(2);
    await activatePrompt(2);
    expect([...admin.promptLabels]).toEqual([["active", 2]]);
  });

  it("is not found for an id that is no version's or not one", async () => {
    for (const id of ["9", "abc", "0"]) {
      await expect(
        render(PromptContent, {
          params: Promise.resolve({ id }),
          searchParams: Promise.resolve({}),
        }),
      ).rejects.toMatchObject(notFound);
    }
  });

  it("refuses every label change to a user who is not an admin, changing nothing, and an admin's goes through", async () => {
    await signIn(otherUser);
    for (const result of [await activatePrompt(2), await testPrompt(2), await clearTestPrompt()]) {
      expect(result).toEqual({ changed: false, message: "관리자만 할 수 있어요." });
    }
    expect([...admin.promptLabels]).toEqual([["active", 1]]);
    expect(admin.audit).toEqual([]);
    await signIn();
    expect(await testPrompt(2)).toMatchObject({ changed: true });
  });
});

describe("the trial on one photo", () => {
  it("runs extract-cards as the admin on the chosen photo and lists the cards it made", async () => {
    const calls = extractCards(() =>
      HttpResponse.json({
        cards: [
          { front: "chat", back: "고양이" },
          { front: "chien", back: "개" },
        ],
      }),
    );
    const user = userEvent.setup();
    await render(AiContent, {});
    const trial = within(screen.getByRole("region", { name: "사진 한 장으로 시험" }));
    await user.upload(
      trial.getByLabelText("사진"),
      new File([new Uint8Array([1, 2, 3])], "page.jpg", { type: "image/jpeg" }),
    );
    await user.click(trial.getByRole("button", { name: "시험하기" }));
    expect(await trial.findByText("카드 2장을 만들었어요.")).toBeInTheDocument();
    expect(
      within(trial.getByRole("list", { name: "만든 카드" }))
        .getAllByRole("listitem")
        .map((card) => card.textContent),
    ).toEqual(["chat고양이", "chien개"]);
    expect(calls).toEqual([{ user: testUser.id, image: "AQID" }]);
  });

  it("says why when the function makes no card, the day's or the month's photos are used, or the photo cannot be read", async () => {
    const answers = [
      HttpResponse.json({ error: "no_cards" }, { status: 422 }),
      HttpResponse.json({ error: "rate_limited", photo_limit: 30, period: "day" }, { status: 429 }),
      HttpResponse.json(
        { error: "rate_limited", photo_limit: 10, period: "month" },
        { status: 429 },
      ),
    ];
    const calls = extractCards(() => answers.shift() ?? HttpResponse.json({}, { status: 500 }));
    const photo = (name: string) => {
      const data = new FormData();
      data.set("photo", new File([new Uint8Array([1])], name, { type: "image/jpeg" }));
      return data;
    };
    expect(await tryPrompt(photo("a.jpg"))).toEqual({
      message: "이 사진에서 카드를 찾지 못했어요.",
    });
    expect(await tryPrompt(photo("b.jpg"))).toEqual({
      message: "오늘 쓸 수 있는 사진 30장을 다 썼어요.",
    });
    expect(await tryPrompt(photo("c.jpg"))).toEqual({
      message: "이번 달 쓸 수 있는 사진 10장을 다 썼어요.",
    });
    expect(calls).toHaveLength(3);

    const user = userEvent.setup();
    await render(AiContent, {});
    await user.upload(
      screen.getByLabelText("사진"),
      new File([new Uint8Array([1])], "unreadable.jpg", { type: "image/jpeg" }),
    );
    await user.click(screen.getByRole("button", { name: "시험하기" }));
    expect(
      await screen.findByText("이 사진을 읽지 못했어요. 다른 사진을 골라 주세요."),
    ).toBeInTheDocument();
    expect(calls).toHaveLength(3);
  });

  it("is refused to a user who is not an admin before the function is called, and an admin's reaches it", async () => {
    const calls = extractCards(() => HttpResponse.json({ cards: [{ front: "a", back: "b" }] }));
    const data = new FormData();
    data.set("photo", new File([new Uint8Array([1])], "page.jpg", { type: "image/jpeg" }));
    await signIn(otherUser);
    expect(await tryPrompt(data)).toEqual({ message: "관리자만 할 수 있어요." });
    expect(calls).toEqual([]);
    await signIn();
    expect(await tryPrompt(data)).toEqual({ cards: [{ front: "a", back: "b" }] });
    expect(calls).toHaveLength(1);
  });
});

/** The first line of each entry of the audit log's list. */
const auditEntries = () =>
  within(screen.getByRole("list", { name: "작업 기록" }))
    .getAllByRole("listitem")
    .map((entry) => entry.firstChild?.textContent);

describe("the audit log", () => {
  it("names each prompt change and links its version", async () => {
    expect(
      await redirected(savePrompt({ message: null }, form({ text: "Third.", note: "" }))),
    ).toContain(";/admin/ai/3;");
    await testPrompt(3);
    await activatePrompt(3);
    await render(AuditContent, {});
    expect(auditEntries()).toEqual([
      "프롬프트 적용 · 버전 3",
      "프롬프트 테스트 시작 · 버전 3",
      "프롬프트 저장 · 버전 3",
    ]);
    expect(screen.getAllByRole("link", { name: "버전 3" })[0]).toHaveAttribute(
      "href",
      "/admin/ai/3",
    );
  });
});
