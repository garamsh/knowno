import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  readTriageActions,
  readTriageAgreement,
  readTriageAppeals,
  readTriageConfigurations,
  readTriageQueue,
  readTriageSample,
  readTriageSettings,
} from "@/features/admin";
import {
  activateTriageConfiguration,
  clearTriageTest,
  recheckTriageAction,
  resolveTriageAppeal,
  resumeTriage,
  saveTriageConfiguration,
  setTriageMode,
  setTriageSettings,
  undoTriageAction,
} from "@/features/admin/actions";
import { FakeAdmin } from "@/testing/mocks/admin";
import { bearerUser, otherUser, supabaseUrl, testUser } from "@/testing/mocks/handlers";
import { server } from "@/testing/mocks/server";
import { setRequestCookies } from "@/testing/next-headers";
import { render } from "@/testing/render";
import { signedInCookies } from "@/testing/session";
import { testRouter } from "@/testing/router";

import { NotesContent } from "../_components/content";

vi.mock("next/headers", () => import("@/testing/next-headers"));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => "/decks",
  useRouter: () => testRouter,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const spam = "d0000000-0000-4000-8000-0000000000b1";
const adult = "d0000000-0000-4000-8000-0000000000b2";
const fresh = "d0000000-0000-4000-8000-0000000000b3";
const single = "d0000000-0000-4000-8000-0000000000b4";
const hiddenByAi = "d0000000-0000-4000-8000-0000000000b5";
const dismissed = "d0000000-0000-4000-8000-0000000000b6";

let admin: FakeAdmin;
/** Every request to the triage's settings route, with its caller and body. */
let sent: { user: string | null; body: Record<string, unknown> }[];
let check: "parsed" | "model_not_found" | "reauth";

const view = (name: string) =>
  render(NotesContent, {
    searchParams: Promise.resolve(name === "reported" ? {} : { view: name }),
  });

/** The reported note named [name], as its table row. */
const noteRow = (name: string) => {
  const found = screen
    .getAllByRole("row")
    .find((candidate) => within(candidate).queryByRole("link", { name }) !== null);
  if (!found) throw new Error(`no row for ${name}`);
  return within(found);
};

/** The item of [list] holding the link [name]. */
const listItem = (list: string, name: string) => {
  const found = within(screen.getByRole("list", { name }))
    .getAllByRole("listitem")
    .find((candidate) => within(candidate).queryByRole("link", { name: list }) !== null);
  if (!found) throw new Error(`no ${name} item for ${list}`);
  return within(found);
};

/** The button [name] of the open confirmation. */
const inGroup = (name: string) => within(screen.getByRole("group")).getByRole("button", { name });

const report = (reason: string, at: string) => ({ reason, at });

function fakeRoute() {
  server.use(
    http.post(`${supabaseUrl}/functions/v1/triage-reports/settings/configuration`, async (info) => {
      const body = (await info.request.json()) as Record<string, unknown>;
      const user = bearerUser(info.request.headers.get("authorization"))?.id ?? null;
      sent.push({ user, body });
      if (user === null || !admin.admins.has(user)) {
        return HttpResponse.json({ error: "forbidden" }, { status: 403 });
      }
      if (check === "reauth") return HttpResponse.json({ error: "reauth" }, { status: 403 });
      if (check !== "parsed") return HttpResponse.json({ error: check }, { status: 422 });
      const cheap = body.cheap as Record<string, unknown>;
      const strong = body.strong as Record<string, unknown>;
      admin.triageConfigurations.push({
        label: "test",
        configuration_id: 7,
        cheap_provider: cheap.provider,
        cheap_model: cheap.model,
        strong_provider: strong.provider,
        strong_model: strong.model,
        prompt: body.prompt,
        cheap_in_usd: cheap.in_usd,
        cheap_out_usd: cheap.out_usd,
        strong_in_usd: strong.in_usd,
        strong_out_usd: strong.out_usd,
        escalate_below: body.escalate_below,
        payload_tokens: body.payload_tokens,
        sample_cards: body.sample_cards,
        set_at: "2026-11-11T01:00:00Z",
        set_by_email: testUser.email,
      });
      return HttpResponse.json({ saved: true, configuration_id: 7 });
    }),
  );
}

function tier(prefix: string, model: string) {
  return {
    [`${prefix}_provider`]: "openrouter",
    [`${prefix}_model`]: model,
    [`${prefix}_in_usd`]: "0.1",
    [`${prefix}_out_usd`]: "0.4",
  };
}

/** A full configuration form, as the browser posts it, with [fields] over its defaults. */
function configurationForm(fields: Partial<Record<string, string>> = {}): FormData {
  const data = new FormData();
  const all = {
    ...tier("cheap", "google/gemini-flash"),
    ...tier("strong", "anthropic/claude-haiku-5.5"),
    prompt: "  Judge the note.  ",
    escalate_below: "0.7",
    payload_tokens: "3000",
    sample_cards: "5",
    ...fields,
  };
  for (const [name, value] of Object.entries(all)) data.set(name, value);
  return data;
}

function settingsForm(fields: Partial<Record<string, string>> = {}): FormData {
  const data = new FormData();
  const all = {
    act_threshold: "0.9",
    daily_cap_usd: "0.5",
    daily_notes: "100",
    sample_percent: "10",
    reporter_daily_cap: "20",
    ...fields,
  };
  for (const [name, value] of Object.entries(all)) data.set(name, value);
  return data;
}

beforeEach(async () => {
  admin = new FakeAdmin();
  sent = [];
  check = "parsed";
  server.use(...admin.handlers);
  fakeRoute();
  admin.seedDeck({
    id: spam,
    name: "Buy now",
    description: "싸게 팝니다 010",
    reports: [
      report("spam", "2026-11-10T01:00:00Z"),
      report("spam", "2026-11-10T02:00:00Z"),
      report("other", "2026-11-10T03:00:00Z"),
    ],
  });
  admin.seedDeck({
    id: adult,
    name: "Late night",
    reports: [report("sexual", "2026-11-08T01:00:00Z"), report("spam", "2026-11-08T02:00:00Z")],
  });
  admin.seedDeck({
    id: fresh,
    name: "Fresh note",
    reports: [report("other", "2026-11-09T01:00:00Z"), report("spam", "2026-11-09T02:00:00Z")],
  });
  admin.seedDeck({
    id: single,
    name: "One report",
    reports: [report("spam", "2026-11-09T05:00:00Z")],
  });
  admin.seedDeck({ id: hiddenByAi, name: "Hidden by AI", hidden: true });
  admin.seedDeck({ id: dismissed, name: "Dismissed by AI" });
  admin.triageVerdicts.set(spam, {
    category: "spam",
    confidence: 0.95,
    passage: "싸게 팝니다",
    field: "description",
    tier: "cheap",
    model: "google/gemini-flash",
    cost_usd: 0.0002,
    judged_at: "2026-11-10T04:00:00Z",
  });
  admin.triageVerdicts.set(adult, {
    category: "severe",
    confidence: 0.8,
    passage: "성인",
    field: "front:senses.1",
    tier: "strong",
    model: "anthropic/claude-haiku-5.5",
    cost_usd: 0.002,
    judged_at: "2026-11-08T04:00:00Z",
  });
  setRequestCookies([...(await signedInCookies()), { name: "smartman-tz", value: "UTC" }]);
});

/** The AI's two actions: it hid [hiddenByAi] and dismissed the reports of [dismissed]. */
function seedActions() {
  admin.triageActions.push(
    {
      id: 1,
      deckId: hiddenByAi,
      action: "hide",
      category: "spam",
      confidence: 0.97,
      model: "google/gemini-flash",
      reason: "광고 문구가 반복돼요",
      createdAt: "2026-11-10T05:00:00Z",
      sampled: true,
      recheckedAt: null,
      recheckAgreed: null,
      undoneAt: null,
    },
    {
      id: 2,
      deckId: dismissed,
      action: "dismiss",
      category: "ok",
      confidence: 0.99,
      model: "anthropic/claude-haiku-5.5",
      reason: "문제가 없어요",
      createdAt: "2026-11-10T06:00:00Z",
      sampled: false,
      recheckedAt: null,
      recheckAgreed: null,
      undoneAt: null,
    },
  );
}

describe("노트's 신고된 노트 verdicts", () => {
  it("shows each note's category, confidence and the quoted passage marked in the field it names, and none on a note one person reported", async () => {
    await view("reported");
    const note = noteRow("Buy now");
    expect(note.getByText("AI 판단: 스팸")).toBeVisible();
    expect(note.getByText("확신 95%")).toBeVisible();
    expect(note.getByText("google/gemini-flash")).toBeVisible();
    expect(note.getByText("설명")).toBeVisible();
    expect(note.getByText("싸게 팝니다").tagName).toBe("MARK");
    // A path after the colon names a string inside a block; the word shown is the side.
    expect(noteRow("Late night").getByText("카드 앞면")).toBeVisible();
    expect(noteRow("Late night").getByText("AI 판단: 심각한 위반")).toBeVisible();
    // A note two reported before the AI judged it says so.
    expect(noteRow("Fresh note").getByText("AI가 아직 판단하지 않았어요.")).toBeVisible();
    // Control: a note one person reported is not in the triage and shows no verdict.
    expect(noteRow("One report").queryByText(/AI/)).not.toBeInTheDocument();
  });

  it("shows a note reported as sexual first, ahead of one reported later", async () => {
    // Made the newest, so only its reason can put it first.
    for (const report of admin.decks.find((deck) => deck.id === adult)!.reports) {
      report.at = "2026-11-12T01:00:00Z";
    }
    await view("reported");
    const names = screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("link")[0]?.textContent);
    expect(names[0]).toBe("Late night");
    expect(noteRow("Late night").getByText(/사유: .*성적인 내용·미성년자/)).toBeVisible();
    // Control: the same note with an ordinary reason is not first.
    cleanup();
    admin.decks.find((deck) => deck.id === adult)!.reports[0]!.reason = "other";
    await view("reported");
    const plain = screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("link")[0]?.textContent);
    expect(plain[0]).not.toBe("Late night");
  });

  it("marks a note the AI acted on and one its owner appealed", async () => {
    seedActions();
    admin.decks
      .find((deck) => deck.id === fresh)!
      .reports.push(report("spam", "2026-11-09T03:00:00Z"));
    admin.triageActions.push({
      ...admin.triageActions[0]!,
      id: 3,
      deckId: fresh,
    });
    admin.triageAppeals.push({
      actionId: 3,
      deckId: fresh,
      appealedAt: "2026-11-10T07:00:00Z",
      resolved: false,
    });
    await view("reported");
    expect(noteRow("Fresh note").getByText("AI가 처리함")).toBeVisible();
    expect(noteRow("Fresh note").getByText("이의 신청")).toBeVisible();
    // Control: a note with no action shows neither.
    expect(noteRow("Buy now").queryByText("AI가 처리함")).not.toBeInTheDocument();
    expect(noteRow("Buy now").queryByText("이의 신청")).not.toBeInTheDocument();
  });
});

describe("노트's AI가 처리한 것", () => {
  it("lists every AI action with its reason and model, marking the ones undone", async () => {
    seedActions();
    admin.triageActions[1]!.undoneAt = "2026-11-10T08:00:00Z";
    await view("triage");
    expect(screen.getByRole("heading", { name: "AI가 처리한 것" })).toBeVisible();
    const hidden = listItem("Hidden by AI", "AI가 처리한 것");
    expect(hidden.getByText("광고 문구가 반복돼요")).toBeVisible();
    expect(hidden.getByText(/google\/gemini-flash/)).toBeVisible();
    expect(hidden.getByText("스팸 · 확신 97%")).toBeVisible();
    expect(hidden.getByText("숨김")).toBeVisible();
    expect(hidden.getByRole("button", { name: "되돌리기" })).toBeVisible();
    // Control: one already undone says so and offers no second undo.
    const done = listItem("Dismissed by AI", "AI가 처리한 것");
    expect(done.getByText("되돌림")).toBeVisible();
    expect(done.queryByRole("button", { name: "되돌리기" })).not.toBeInTheDocument();
  });

  it("undoes an action only after a confirmation", async () => {
    seedActions();
    await view("triage");
    const hidden = () => listItem("Hidden by AI", "AI가 처리한 것");
    await userEvent.click(hidden().getByRole("button", { name: "되돌리기" }));
    expect(
      screen.getByRole("group", {
        name: "'Hidden by AI' 노트의 숨김을 풀까요? 공개 목록에 다시 보여요.",
      }),
    ).toBeVisible();
    // Asking is not undoing: nothing was called, and cancelling leaves it so.
    expect(admin.calls.some((call) => call.startsWith("admin_undo_triage_action"))).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(admin.calls.some((call) => call.startsWith("admin_undo_triage_action"))).toBe(false);
    expect(admin.decks.find((deck) => deck.id === hiddenByAi)).toMatchObject({ hidden: true });

    // Control: confirming does it.
    await userEvent.click(hidden().getByRole("button", { name: "되돌리기" }));
    await userEvent.click(inGroup("되돌리기"));
    expect(await screen.findByText("되돌렸어요.")).toBeVisible();
    expect(admin.calls).toContain('admin_undo_triage_action {"action_id":1}');
    expect(admin.decks.find((deck) => deck.id === hiddenByAi)).toMatchObject({ hidden: false });
    expect(admin.audit[0]).toMatchObject({ action: "undo_triage_action", target_id: hiddenByAi });
  });

  it("says what each answer of an undo means, and refuses an id that is not one", async () => {
    seedActions();
    expect(await undoTriageAction(1)).toEqual({ changed: true, message: "되돌렸어요." });
    expect(await undoTriageAction(1)).toEqual({ changed: false, message: "이미 되돌렸어요." });
    expect(await undoTriageAction(99)).toEqual({
      changed: false,
      message: "찾을 수 없는 기록이에요.",
    });
    const before = admin.calls.length;
    expect((await undoTriageAction(0)).changed).toBe(false);
    expect((await undoTriageAction(1.5)).changed).toBe(false);
    expect(admin.calls).toHaveLength(before);
  });

  it("lists the sample to re-check and records whether the admin agrees, once", async () => {
    seedActions();
    await view("triage");
    const sample = within(screen.getByRole("list", { name: "다시 확인할 것" }));
    // Only the sampled action is there; the other is the control.
    expect(sample.getAllByRole("listitem")).toHaveLength(1);
    expect(sample.getByRole("link", { name: "Hidden by AI" })).toBeVisible();
    expect(sample.queryByRole("link", { name: "Dismissed by AI" })).not.toBeInTheDocument();
    await userEvent.click(sample.getByRole("button", { name: "맞아요" }));
    await userEvent.click(inGroup("맞아요"));
    expect(await screen.findByText("확인한 결과를 남겼어요.")).toBeVisible();
    expect(admin.triageActions[0]).toMatchObject({ recheckAgreed: true });
    expect(admin.audit[0]).toMatchObject({
      action: "recheck_triage_action",
      detail: { agreed: true },
    });
    expect(await recheckTriageAction(1, false)).toEqual({
      changed: false,
      message: "이미 확인한 기록이에요.",
    });
    expect(await recheckTriageAction(2, true)).toEqual({
      changed: false,
      message: "다시 확인 대상이 아닌 기록이에요.",
    });

    cleanup();
    await view("triage");
    expect(screen.getByText("다시 확인할 것이 없어요.")).toBeVisible();
  });

  it("lists the appeals with the passage and decides each: restoring the note, or leaving it", async () => {
    seedActions();
    admin.triageVerdicts.set(hiddenByAi, {
      category: "spam",
      confidence: 0.97,
      passage: "지금 사세요",
      field: "name",
      tier: "cheap",
      model: "google/gemini-flash",
      cost_usd: 0.0001,
      judged_at: "2026-11-10T05:00:00Z",
    });
    admin.triageAppeals.push({
      actionId: 1,
      deckId: hiddenByAi,
      appealedAt: "2026-11-10T09:00:00Z",
      resolved: false,
    });
    await view("triage");
    const appeals = within(screen.getByRole("list", { name: "이의 신청" }));
    expect(appeals.getByText("지금 사세요").tagName).toBe("MARK");
    expect(appeals.getByText("노트 이름")).toBeVisible();
    await userEvent.click(appeals.getByRole("button", { name: "그대로 두기" }));
    expect(admin.calls.some((call) => call.startsWith("admin_resolve_triage_appeal"))).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "취소" }));
    await userEvent.click(appeals.getByRole("button", { name: "되돌리기" }));
    await userEvent.click(inGroup("되돌리기"));
    expect(await screen.findByText("노트를 되돌려 놓았어요.")).toBeVisible();
    expect(admin.decks.find((deck) => deck.id === hiddenByAi)).toMatchObject({ hidden: false });
    expect(admin.audit[0]).toMatchObject({ action: "resolve_triage_appeal" });

    // The other answers, and nothing left to decide.
    expect(await resolveTriageAppeal(hiddenByAi, false)).toEqual({
      changed: false,
      message: "처리할 이의 신청이 없어요.",
    });
    admin.triageAppeals.push({
      actionId: 1,
      deckId: hiddenByAi,
      appealedAt: "2026-11-10T09:00:00Z",
      resolved: false,
    });
    expect(await resolveTriageAppeal(hiddenByAi, false)).toEqual({
      changed: true,
      message: "AI가 한 처리를 그대로 두었어요.",
    });
    cleanup();
    await view("triage");
    expect(screen.getByText("처리할 이의 신청이 없어요.")).toBeVisible();
  });

  it("says each list is empty when nothing is in it", async () => {
    await view("triage");
    expect(
      screen.getByText("AI가 처리한 것이 없어요. AI가 판단만 하는 동안에는 여기에 쌓이지 않아요."),
    ).toBeVisible();
    expect(screen.getByText("다시 확인할 것이 없어요.")).toBeVisible();
    expect(screen.getByText("처리할 이의 신청이 없어요.")).toBeVisible();
  });
});

describe("노트's 신고 AI 설정", () => {
  it("shows the AI as judging only, and names its mode that way by default", async () => {
    await view("triage-settings");
    expect(screen.getByRole("heading", { name: "처리 방식" })).toBeVisible();
    expect(screen.getByLabelText("현재 처리 방식")).toHaveTextContent("판단만 하기");
    expect(screen.getByRole("button", { name: "직접 처리하기로 바꾸기" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "판단만 하기로 바꾸기" })).not.toBeInTheDocument();
  });

  it("shows a mode the server holds as acting only when it says exactly acting", async () => {
    // Control: acting is shown as acting, with the way back.
    admin.triageSettings.mode = "acting";
    await view("triage-settings");
    expect(screen.getByLabelText("현재 처리 방식")).toHaveTextContent("직접 처리하기");
    expect(screen.getByRole("button", { name: "판단만 하기로 바꾸기" })).toBeVisible();
    cleanup();
    // A word this version does not know is not acting.
    admin.triageSettings.mode = "ACTING";
    await view("triage-settings");
    expect(screen.getByLabelText("현재 처리 방식")).toHaveTextContent("판단만 하기");
  });

  it("sends judge-only for any mode that is not exactly acting, and acting only when asked", async () => {
    expect((await setTriageMode("")).message).toBe("이제 AI는 판단만 하고 아무것도 바꾸지 않아요.");
    expect(admin.triageSettings.mode).toBe("judge_only");
    await setTriageMode("Acting");
    expect(admin.triageSettings.mode).toBe("judge_only");
    // Control: exactly acting turns it on, and the audit names the new mode.
    expect((await setTriageMode("acting")).message).toBe(
      "이제 AI가 직접 처리해요. 처리한 것은 모두 되돌릴 수 있어요.",
    );
    expect(admin.triageSettings.mode).toBe("acting");
    expect(admin.audit[0]).toMatchObject({
      action: "set_triage_settings",
      detail: { mode: "acting" },
    });
  });

  it("switches the mode only after a confirmation", async () => {
    await view("triage-settings");
    await userEvent.click(screen.getByRole("button", { name: "직접 처리하기로 바꾸기" }));
    expect(admin.triageSettings.mode).toBe("judge_only");
    expect(admin.calls.some((call) => call.startsWith("admin_set_triage_settings"))).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "직접 처리하기" }));
    expect(
      await screen.findByText("이제 AI가 직접 처리해요. 처리한 것은 모두 되돌릴 수 있어요."),
    ).toBeVisible();
    expect(admin.triageSettings.mode).toBe("acting");
  });

  it("shows the day's spend, the undo rate and the agreement rate of each category", async () => {
    Object.assign(admin.triageSettings, {
      spent_today_usd: 0.1234,
      judged_today: 12,
      actions_in_window: 8,
      undo_rate: 0.25,
    });
    admin.triageAgreement.push(
      { category: "ok", compared: 4, agreed: 4 },
      { category: "spam", compared: 8, agreed: 6 },
    );
    await view("triage-settings");
    expect(screen.getByText("$0.1234 / $0.5000")).toBeVisible();
    expect(screen.getByText("12 / 100")).toBeVisible();
    expect(screen.getByText("25%")).toBeVisible();
    const table = within(screen.getByRole("table", { name: "관리자와의 일치율" }));
    expect(table.getByRole("row", { name: /스팸/ })).toHaveTextContent("8");
    expect(table.getByRole("row", { name: /스팸/ })).toHaveTextContent("75%");
    expect(table.getByRole("row", { name: /문제없음/ })).toHaveTextContent("100%");
  });

  it("says there is no agreement to show yet, and no rate with no action in the window", async () => {
    await view("triage-settings");
    expect(screen.getByText("아직 비교한 것이 없어요.")).toBeVisible();
    expect(screen.queryByRole("table", { name: "관리자와의 일치율" })).not.toBeInTheDocument();
    expect(screen.getByText("없음")).toBeVisible();
  });

  it("shows a pause the undo rate set, and lifts it after a confirmation", async () => {
    admin.triageSettings.paused_at = "2026-11-10T10:00:00Z";
    admin.triageSettings.paused_reason = "undo_rate";
    await view("triage-settings");
    expect(screen.getByText(/되돌린 비율이 기준을 넘어/)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "다시 켜기" }));
    expect(admin.triageSettings.paused_at).not.toBeNull();
    await userEvent.click(inGroup("다시 켜기"));
    expect(await screen.findByText("다시 켰어요.")).toBeVisible();
    expect(admin.triageSettings.paused_at).toBeNull();
    expect(await resumeTriage()).toEqual({ changed: false, message: "멈춘 상태가 아니에요." });

    // Control: with no pause there is nothing to lift.
    cleanup();
    await view("triage-settings");
    expect(screen.queryByRole("button", { name: "다시 켜기" })).not.toBeInTheDocument();
  });

  it("sets the threshold and caps within the server's ranges, and calls nothing for a value outside them", async () => {
    const save = (fields: Partial<Record<string, string>>) =>
      setTriageSettings({ message: null }, settingsForm(fields));
    const before = () => admin.calls.filter((call) => call.startsWith("admin_set_triage")).length;
    for (const bad of [
      { act_threshold: "0.4" },
      { act_threshold: "1.1" },
      { daily_cap_usd: "1001" },
      { daily_cap_usd: "-1" },
      { daily_notes: "10001" },
      { daily_notes: "1.5" },
      { sample_percent: "101" },
      { reporter_daily_cap: "0" },
      { reporter_daily_cap: "1001" },
      { act_threshold: "" },
    ]) {
      expect((await save(bad)).message).not.toBe("설정을 바꿨어요.");
      expect(before()).toBe(0);
    }
    // Control: values at the edges of the ranges go through.
    expect(
      await save({
        act_threshold: "0.5",
        daily_cap_usd: "1000",
        daily_notes: "10000",
        sample_percent: "0",
        reporter_daily_cap: "1",
      }),
    ).toEqual({ message: "설정을 바꿨어요." });
    expect(admin.calls.at(-1)).toBe(
      'admin_set_triage_settings {"act_threshold":0.5,"daily_cap_usd":1000,"daily_notes":10000,"sample_percent":0,"reporter_daily_cap":1}',
    );
    expect(admin.triageSettings).toMatchObject({ act_threshold: 0.5, mode: "judge_only" });
    expect(admin.audit[0]).toMatchObject({ action: "set_triage_settings" });
  });

  it("starts the settings form from the values in force", async () => {
    admin.triageSettings.act_threshold = 0.85;
    await view("triage-settings");
    const form = within(screen.getByRole("form", { name: "신고 AI 기준과 한도" }));
    expect(form.getByLabelText("처리할 확신 기준")).toHaveValue(0.85);
    expect(form.getByLabelText("하루 비용 한도 (달러)")).toHaveValue(0.5);
    await userEvent.clear(form.getByLabelText("처리할 확신 기준"));
    await userEvent.type(form.getByLabelText("처리할 확신 기준"), "0.95");
    await userEvent.click(form.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("설정을 바꿨어요.")).toBeVisible();
    expect(admin.triageSettings.act_threshold).toBe(0.95);
  });

  it("saves a configuration through the triage's settings route as the draft, and applies or ends it after a confirmation", async () => {
    await view("triage-settings");
    expect(screen.getByText(/저장된 구성이 없어요/)).toBeVisible();
    expect(
      await saveTriageConfiguration({ message: null, reauth: false }, configurationForm()),
    ).toEqual({
      message: "확인하고 초안으로 저장했어요. 적용하기 전에는 쓰이지 않아요.",
      reauth: false,
    });
    expect(sent.at(-1)).toEqual({
      user: testUser.id,
      body: {
        cheap: { provider: "openrouter", model: "google/gemini-flash", in_usd: 0.1, out_usd: 0.4 },
        strong: {
          provider: "openrouter",
          model: "anthropic/claude-haiku-5.5",
          in_usd: 0.1,
          out_usd: 0.4,
        },
        prompt: "Judge the note.",
        escalate_below: 0.7,
        payload_tokens: 3000,
        sample_cards: 5,
      },
    });
    cleanup();
    await view("triage-settings");
    expect(screen.getByRole("heading", { name: "초안 (관리자만 테스트 중)" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "적용" }));
    expect(admin.triageConfigurations[0]).toMatchObject({ label: "test" });
    await userEvent.click(inGroup("적용"));
    expect(await screen.findByText("신고 AI에 적용했어요.")).toBeVisible();
    expect(admin.triageConfigurations[0]).toMatchObject({ label: "active" });
    expect(await activateTriageConfiguration()).toEqual({
      changed: false,
      message: "테스트 중인 구성이 없어요.",
    });
    expect(await clearTriageTest()).toEqual({
      changed: false,
      message: "테스트 중인 구성이 없어요.",
    });
    await saveTriageConfiguration({ message: null, reauth: false }, configurationForm());
    expect(await clearTriageTest()).toEqual({ changed: true, message: "테스트를 끝냈어요." });
    expect(admin.triageConfigurations.map((entry) => entry.label)).toEqual(["active"]);
    cleanup();
    await view("triage-settings");
    expect(screen.getByRole("heading", { name: "사용 중인 구성" })).toBeVisible();
    expect(screen.getByText(/google\/gemini-flash/)).toBeVisible();
  });

  it("says why a save failed, and refuses a malformed form and a user who is not an admin before the route", async () => {
    const save = (fields: Partial<Record<string, string>>) =>
      saveTriageConfiguration({ message: null, reauth: false }, configurationForm(fields));
    check = "model_not_found";
    expect((await save({})).message).toBe("이 제공자에 없는 모델이에요. 모델 ID를 확인해 주세요.");
    check = "reauth";
    expect(await save({})).toEqual({
      message: "보안을 위해 다시 로그인한 뒤 저장해 주세요.",
      reauth: true,
    });
    expect(admin.triageConfigurations).toEqual([]);

    const asked = sent.length;
    for (const bad of [
      { cheap_model: "no-slash" },
      { strong_model: "" },
      { cheap_provider: "nobody" },
      { cheap_in_usd: "1001" },
      { strong_out_usd: "-1" },
      { prompt: "   " },
      { prompt: "x".repeat(8001) },
      { escalate_below: "1.5" },
      { payload_tokens: "499" },
      { payload_tokens: "20001" },
      { sample_cards: "51" },
    ]) {
      expect((await save(bad)).message).not.toBe(null);
      expect(sent).toHaveLength(asked);
    }
    // Control: the form without a fault reaches the route once the check parses.
    check = "parsed";
    await save({});
    expect(sent).toHaveLength(asked + 1);

    setRequestCookies([
      ...(await signedInCookies(otherUser)),
      { name: "smartman-tz", value: "UTC" },
    ]);
    expect((await save({})).message).toBe("관리자만 할 수 있어요.");
  });
});

describe("노트's triage reads against the server's real answers", () => {
  it("reads a null failures as none, for a judged note and for one not claimed, and shows the failed tries of a claimed one", async () => {
    // The server answers null where no attempt row stands: the common case.
    expect(admin.triageFailures.size).toBe(0);
    await view("reported");
    expect(noteRow("Buy now").getByText("AI 판단: 스팸")).toBeVisible();
    expect(noteRow("Fresh note").getByText("AI가 아직 판단하지 않았어요.")).toBeVisible();
    cleanup();
    admin.triageFailures.set(fresh, 2);
    await view("reported");
    expect(
      noteRow("Fresh note").getByText("AI가 판단하지 못했어요 (2번 실패). 사람이 확인해 주세요."),
    ).toBeVisible();
    // Control: the unclaimed note beside it still reads as not yet judged.
    expect(noteRow("Buy now").queryByText(/번 실패/)).not.toBeInTheDocument();
    expect(noteRow("Buy now").getByText("AI 판단: 스팸")).toBeVisible();
  });

  it("names a deleted note in the actions, the sample and the appeals, beside a live one", async () => {
    seedActions();
    admin.triageActions[0]!.sampled = true;
    admin.triageActions[1]!.sampled = true;
    // The tombstone purge empties a deleted deck's name; the server's joins keep its rows.
    admin.decks.find((deck) => deck.id === hiddenByAi)!.name = "";
    admin.triageAppeals.push({
      actionId: 1,
      deckId: hiddenByAi,
      appealedAt: "2026-11-10T09:00:00Z",
      resolved: false,
    });
    admin.triageAppeals.push({
      actionId: 2,
      deckId: dismissed,
      appealedAt: "2026-11-10T09:30:00Z",
      resolved: false,
    });
    await view("triage");
    for (const list of ["AI가 처리한 것", "다시 확인할 것", "이의 신청"]) {
      const items = within(screen.getByRole("list", { name: list })).getAllByRole("listitem");
      expect(items).toHaveLength(2);
      expect(
        within(items.find((item) => /삭제된 노트/.test(item.textContent))!).getByRole("link"),
      ).toBeVisible();
      // Control: the live note keeps its own name.
      expect(
        items.some(
          (item) => within(item).queryByRole("link", { name: "Dismissed by AI" }) !== null,
        ),
      ).toBe(true);
    }
  });

  it("shows the threshold as stored in the sentence that switches the AI to acting", async () => {
    admin.triageSettings.act_threshold = 0.905;
    await view("triage-settings");
    await userEvent.click(screen.getByRole("button", { name: "직접 처리하기로 바꾸기" }));
    expect(screen.getByRole("group")).toHaveTextContent("확신 0.905 이상인 노트를");
  });

  it("says that the AI's hiding no longer applies when an undo or an appeal finds the note not hidden", async () => {
    seedActions();
    // An admin's own hold may still hide the note: the AI's has ended, which is all it says.
    admin.decks.find((deck) => deck.id === hiddenByAi)!.hidden = false;
    expect(await undoTriageAction(1)).toEqual({
      changed: false,
      message: "AI가 숨긴 상태는 이미 아니라서 바뀐 것이 없어요. 운영자가 숨긴 노트는 그대로예요.",
    });
    admin.triageAppeals.push({
      actionId: 1,
      deckId: hiddenByAi,
      appealedAt: "2026-11-10T09:00:00Z",
      resolved: false,
    });
    expect(await resolveTriageAppeal(hiddenByAi, true)).toEqual({
      changed: true,
      message: "이의 신청은 처리했지만 노트는 되돌리지 못했어요. AI가 숨긴 상태는 이미 아니에요.",
    });
    // Control: a note still hidden is restored, and says so.
    admin.decks.find((deck) => deck.id === hiddenByAi)!.hidden = true;
    admin.triageActions[0]!.undoneAt = null;
    expect(await undoTriageAction(1)).toEqual({ changed: true, message: "되돌렸어요." });
  });
});

describe("노트's triage reads of a malformed row", () => {
  const answer = (name: string, rows: object[]) => {
    server.use(http.post(`${supabaseUrl}/rest/v1/rpc/${name}`, () => HttpResponse.json(rows)));
  };
  const note = {
    deck_id: spam,
    name: "Buy now",
    owner_id: testUser.id,
    hidden: false,
    publication: "public",
    reporters: 2,
    reasons: ["spam"],
    last_reported_at: "2026-11-10T03:00:00Z",
    category: "spam",
    confidence: 0.9,
    passage: "싸게 팝니다",
    field: "description",
    tier: "cheap",
    model: "google/gemini-flash",
    cost_usd: 0.0002,
    judged_at: "2026-11-10T04:00:00Z",
    action_id: null,
    appealed: false,
    failures: null,
  };
  const action = {
    action_id: 1,
    deck_id: spam,
    name: "Buy now",
    action: "hide",
    category: "spam",
    confidence: 0.9,
    model: "google/gemini-flash",
    reason: "광고예요",
    created_at: "2026-11-10T05:00:00Z",
    sampled: true,
    rechecked_at: null,
    recheck_agreed: null,
    undone_at: null,
  };
  const appeal = {
    deck_id: spam,
    name: "Buy now",
    owner_id: testUser.id,
    appealed_at: "2026-11-10T09:00:00Z",
    action_id: 1,
    category: "spam",
    confidence: 0.9,
    passage: null,
    field: null,
  };
  const agreement = { category: "spam", compared: 4, agreed: 3 };
  const configuration = {
    label: "active",
    configuration_id: 1,
    cheap_provider: "openrouter",
    cheap_model: "google/gemini-flash",
    cheap_in_usd: 0.1,
    cheap_out_usd: 0.4,
    strong_provider: "openrouter",
    strong_model: "anthropic/claude-haiku-5.5",
    strong_in_usd: 0.1,
    strong_out_usd: 0.4,
    prompt: "Judge.",
    escalate_below: 0.7,
    payload_tokens: 3000,
    sample_cards: 5,
    set_at: "2026-11-10T01:00:00Z",
    set_by_email: null,
  };
  const cases: [string, string, () => Promise<unknown>, object, object][] = [
    ["the queue", "admin_triage_queue", readTriageQueue, note, { ...note, confidence: 5 }],
    [
      "the actions",
      "admin_triage_actions",
      readTriageActions,
      action,
      { ...action, confidence: 5 },
    ],
    [
      "the sample",
      "admin_triage_sample",
      readTriageSample,
      action,
      { ...action, confidence: -0.1 },
    ],
    [
      "the appeals",
      "admin_triage_appeals",
      readTriageAppeals,
      appeal,
      { ...appeal, confidence: 5 },
    ],
    [
      "the agreement",
      "admin_triage_agreement",
      readTriageAgreement,
      agreement,
      { ...agreement, compared: "many" },
    ],
    [
      "the configurations",
      "admin_triage_configurations",
      readTriageConfigurations,
      configuration,
      { ...configuration, label: "draft" },
    ],
  ];
  it.each(cases)("reads %s whole or not at all", async (_name, rpc, read, good, bad) => {
    // Control: the well-formed row is read.
    answer(rpc, [good]);
    expect(await read()).toHaveProperty("data");
    answer(rpc, [good, bad]);
    expect(await read()).toEqual({ failure: "unreadable" });
  });

  it("reads the settings row whole or not at all", async () => {
    const good = { ...admin.triageSettings };
    answer("admin_triage_settings", [good]);
    expect(await readTriageSettings()).toHaveProperty("data");
    answer("admin_triage_settings", [{ ...good, act_threshold: "high" }]);
    expect(await readTriageSettings()).toEqual({ failure: "unreadable" });
  });
});
