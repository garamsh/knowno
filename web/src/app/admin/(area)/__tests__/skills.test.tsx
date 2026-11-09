import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  activateCardFormSkill,
  clearCardFormSkillTest,
  saveCardFormSkill,
} from "@/features/admin/actions";
import { readCardFormSkills } from "@/features/admin";
import { FakeAdmin } from "@/testing/mocks/admin";
import { otherUser, supabaseUrl, testUser } from "@/testing/mocks/handlers";
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

/** 말랑이 as the address [params] opens it. */
const assistant = (params: Record<string, string> = {}) =>
  render(AssistantContent, { searchParams: Promise.resolve(params) });

/** The cloze skill's draft, version 7, over the seed's version 3. */
function seedDraft() {
  admin.cardFormSkills.push({
    id: 7,
    form: "cloze",
    summary: "cloze, tried",
    text: "# cloze\nUse it for cloze.\nRule two.",
    note: "adds a rule",
    by: testUser.id,
  });
  admin.cardFormSkillLabels.set("cloze test", 7);
}

beforeEach(async () => {
  admin = new FakeAdmin();
  server.use(...admin.handlers);
  await signIn();
});

describe("the card forms' skills on 말랑이", () => {
  it("lists each form with the version in use and its summary, and a draft where one is set", async () => {
    seedDraft();
    await assistant();
    const list = within(screen.getByRole("list", { name: "카드 형식 스킬" }));
    expect(list.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "글 · v1 사용 중text summary",
      "단어 · v2 사용 중senses summary",
      "빈칸 문장 · v3 사용 중cloze summaryv7 테스트 중",
      "표 · v4 사용 중table summary",
      "사진 · v5 사용 중image summary",
      "섞어서 · v6 사용 중mixed summary",
    ]);
    expect(list.getByRole("link", { name: /^글 / })).toHaveAttribute(
      "href",
      "/assistant?plan=free&skill=text",
    );
    // Control: with no skill named, no skill's panel is open.
    expect(screen.queryByRole("form", { name: /새 버전$/ })).toBeNull();
  });

  it("opens a form's draft against the version in use: what it changes, its lines, and the form from the draft", async () => {
    seedDraft();
    await assistant({ skill: "cloze" });
    const panel = within(
      screen.getByRole("region", { name: "빈칸 문장 · 초안 (관리자만 테스트 중)" }),
    );
    expect(panel.getByRole("heading", { name: "cloze, tried" })).toBeInTheDocument();
    expect(panel.getByText("지금 사용 중: v3 · cloze summary")).toBeInTheDocument();
    expect(panel.getByText("빈칸 문장 스킬 v3 → v7 다른 점")).toBeInTheDocument();
    expect(panel.getByText("Rule two.")).toBeInTheDocument();
    expect(panel.getByRole("button", { name: "모두에게 적용" })).toBeInTheDocument();
    const edit = within(panel.getByRole("form", { name: "빈칸 문장 새 버전" }));
    expect(edit.getByRole("textbox", { name: "한 줄 요약" })).toHaveValue("cloze, tried");
    expect(edit.getByRole("textbox", { name: /가이드/ })).toHaveValue(
      "# cloze\nUse it for cloze.\nRule two.",
    );
    expect(panel.getByRole("link", { name: /^v7 · 초안/ })).toHaveAttribute(
      "href",
      "/assistant?plan=free&skill=cloze&from=7",
    );
    expect(panel.getByRole("link", { name: /^v3 · 사용 중/ })).toBeInTheDocument();
  });

  it("opens a form with no draft as its version in use with no action, and starts the form from the version the address names", async () => {
    seedDraft();
    await assistant({ skill: "table" });
    const panel = within(screen.getByRole("region", { name: "표 · 사용 중인 스킬" }));
    expect(panel.getByRole("heading", { name: "table summary" })).toBeInTheDocument();
    expect(panel.queryByRole("button", { name: "모두에게 적용" })).toBeNull();
    cleanup();
    await assistant({ skill: "cloze", from: "3" });
    const edit = within(screen.getByRole("form", { name: "빈칸 문장 새 버전" }));
    expect(edit.getByRole("textbox", { name: "한 줄 요약" })).toHaveValue("cloze summary");
    // Control: a version of another form is not one to start from.
    cleanup();
    await assistant({ skill: "cloze", from: "4" });
    expect(
      within(screen.getByRole("form", { name: "빈칸 문장 새 버전" })).getByRole("textbox", {
        name: "한 줄 요약",
      }),
    ).toHaveValue("cloze, tried");
  });

  it("says what failed for a reader who is not an admin", async () => {
    await signIn(otherUser);
    await assistant({ skill: "cloze" });
    expect(screen.getByText("관리자만 볼 수 있어요.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "카드 형식 스킬" })).toBeNull();
  });
});

describe("a skill version labelled markup (ADR 0216)", () => {
  /** The text form's markup version, 8, beside its version 1 in use. */
  function seedMarkup() {
    admin.cardFormSkills.push({
      id: 8,
      form: "text",
      summary: "text, markup",
      text: "# text\nUse markup.",
      note: "markup (#763)",
      by: null,
    });
    admin.cardFormSkillLabels.set("text markup", 8);
  }

  it("reads a version labelled markup beside the one in use, and refuses a label it does not know", async () => {
    seedMarkup();
    const read = await readCardFormSkills();
    if ("failure" in read) throw new Error(`the read failed: ${read.failure}`);
    expect(read.data.find((skill) => skill.id === 8)?.labels).toEqual(["markup"]);
    expect(read.data.find((skill) => skill.id === 1)?.labels).toEqual(["active"]);
    // Control: the same row with a label outside active, test and markup is refused as unreadable.
    server.use(
      http.post(`${supabaseUrl}/rest/v1/rpc/admin_card_form_skills`, () =>
        HttpResponse.json([
          {
            id: 8,
            form: "text",
            summary: "s",
            text: "t",
            note: "",
            created_by_email: null,
            created_at: "2026-11-05T01:00:00Z",
            labels: ["markup", "staging"],
          },
        ]),
      ),
    );
    expect(await readCardFormSkills()).toEqual({ failure: "unreadable" });
  });

  it("names the version in a form's versions as served while markup is on, neither in use nor the draft, and the list still reads", async () => {
    seedMarkup();
    await assistant({ skill: "text" });
    expect(screen.getByRole("link", { name: /^글 · v1 사용 중/ })).toBeInTheDocument();
    const versions = within(screen.getByRole("list", { name: "글 스킬 버전" }));
    const links = versions.getAllByRole("link").map((link) => link.textContent);
    expect(links[0]).toMatch(/^v8 · 마크업 켜면 사용 · /);
    expect(links[0]).not.toMatch(/사용 중|초안/);
    // Control: the version in use keeps its own label and no markup one.
    expect(links[1]).toMatch(/^v1 · 사용 중 · /);
    expect(links[1]).not.toMatch(/마크업/);
  });
});

describe("a skill draft: saved, applied to everyone or ended", () => {
  it("saves the form as the form's draft, serves it to no one else, records it and returns to the form's panel, refusing what the server limits and a user who is not an admin", async () => {
    const fields = { summary: " Blanks. ", text: "# cloze\nNew guide.", note: " try " };
    expect(
      (await saveCardFormSkill("cloze", { message: null }, form({ ...fields, summary: "a\nb" })))
        .message,
    ).toBe("한 줄 요약을 300자 안으로 적어 주세요.");
    expect(
      (await saveCardFormSkill("cloze", { message: null }, form({ ...fields, text: " \n " })))
        .message,
    ).toBe("가이드를 2만 자 안으로 적어 주세요.");
    expect(
      (
        await saveCardFormSkill(
          "cloze",
          { message: null },
          form({ ...fields, note: "x".repeat(201) }),
        )
      ).message,
    ).toBe("메모는 200자 안으로 적어 주세요.");
    expect(
      (await saveCardFormSkill("poem", { message: null }, form(fields))).message,
      "an unknown form",
    ).toBe("하지 못했어요. 잠시 후 다시 시도해 주세요.");
    await signIn(otherUser);
    expect(await saveCardFormSkill("cloze", { message: null }, form(fields))).toEqual({
      message: "관리자만 할 수 있어요.",
    });
    expect(admin.cardFormSkills).toHaveLength(6);

    await signIn();
    expect(await redirectTarget(saveCardFormSkill("cloze", { message: null }, form(fields)))).toBe(
      "/assistant?skill=cloze",
    );
    expect(admin.cardFormSkills.at(-1)).toEqual({
      id: 7,
      form: "cloze",
      summary: "Blanks.",
      text: "# cloze\nNew guide.",
      note: "try",
      by: testUser.id,
    });
    expect(admin.cardFormSkillLabels.get("cloze test")).toBe(7);
    expect(admin.cardFormSkillLabels.get("cloze active"), "the version in use is kept").toBe(3);
    expect(admin.audit.map((entry) => entry.action)).toEqual(["save_card_form_skill"]);
    await render(AdminsContent, {});
    expect(screen.getByRole("link", { name: "빈칸 문장" })).toHaveAttribute(
      "href",
      "/assistant?skill=cloze",
    );
    // A browser posts a textarea's breaks as CRLF; the version keeps them as LF.
    await redirectTarget(
      saveCardFormSkill(
        "cloze",
        { message: null },
        form({ ...fields, text: "# cloze\r\nNew guide.\rLast." }),
      ),
    );
    expect(admin.cardFormSkills.at(-1)?.text).toBe("# cloze\nNew guide.\nLast.");
  });

  it("applies the draft to everyone, ends it without applying, and says there is none to do either with", async () => {
    seedDraft();
    expect(await clearCardFormSkillTest("table")).toEqual({
      changed: false,
      message: "테스트 중인 스킬이 없어요.",
    });
    expect(await activateCardFormSkill("table")).toEqual({
      changed: false,
      message: "테스트 중인 스킬이 없어요.",
    });
    expect(await clearCardFormSkillTest("poem")).toEqual({
      changed: false,
      message: "하지 못했어요. 잠시 후 다시 시도해 주세요.",
    });
    expect(await activateCardFormSkill("poem")).toMatchObject({
      message: "하지 못했어요. 잠시 후 다시 시도해 주세요.",
    });
    expect(admin.calls.some((call) => call.includes("poem") || call.includes("null"))).toBe(false);
    expect(admin.cardFormSkillLabels.get("cloze test")).toBe(7);

    expect(await activateCardFormSkill("cloze")).toEqual({
      changed: true,
      message: "모든 사용자에게 적용했어요.",
    });
    expect(admin.cardFormSkillLabels.get("cloze active")).toBe(7);
    expect(admin.cardFormSkillLabels.has("cloze test")).toBe(false);

    admin.cardFormSkills.push({
      id: 8,
      form: "senses",
      summary: "senses, tried",
      text: "# senses\nTried.",
      note: "",
      by: testUser.id,
    });
    admin.cardFormSkillLabels.set("senses test", 8);
    expect(await clearCardFormSkillTest("senses")).toEqual({
      changed: true,
      message: "테스트를 끝냈어요. 관리자도 사용 중인 스킬을 써요.",
    });
    expect(admin.cardFormSkillLabels.get("senses active"), "ending a test applies nothing").toBe(2);
    expect(admin.cardFormSkillLabels.has("senses test")).toBe(false);
    // Newest first, as the log lists them.
    expect(admin.audit.map((entry) => entry.action)).toEqual([
      "clear_card_form_skill_test",
      "activate_card_form_skill",
    ]);
  });

  it("asks before it ends or applies a draft, and acts on the confirmation", async () => {
    seedDraft();
    const user = userEvent.setup();
    await assistant({ skill: "cloze" });
    await user.click(screen.getByRole("button", { name: "모두에게 적용" }));
    expect(screen.getByText("빈칸 문장 스킬의 이 초안을 모두에게 적용할까요?")).toBeInTheDocument();
    expect(admin.cardFormSkillLabels.get("cloze active")).toBe(3);
    await user.click(screen.getByRole("button", { name: "적용" }));
    expect(await screen.findByText("모든 사용자에게 적용했어요.")).toBeInTheDocument();
    expect(admin.cardFormSkillLabels.get("cloze active")).toBe(7);
  });
});
