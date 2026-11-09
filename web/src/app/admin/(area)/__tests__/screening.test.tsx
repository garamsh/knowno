import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { screeningWords } from "@/features/admin";
import { FakeAdmin } from "@/testing/mocks/admin";
import { server } from "@/testing/mocks/server";
import { setRequestCookies } from "@/testing/next-headers";
import { render } from "@/testing/render";
import { signedInCookies } from "@/testing/session";
import { testRouter } from "@/testing/router";

import { NotesContent, TodoContent } from "../_components/content";

vi.mock("next/headers", () => import("@/testing/next-headers"));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => "/decks",
  useRouter: () => testRouter,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const memo = "d0000000-0000-4000-8000-0000000000a1";
const plain = "d0000000-0000-4000-8000-0000000000a2";
const contact = "문의는 010-1234-5678 로";

let admin: FakeAdmin;
beforeEach(async () => {
  admin = new FakeAdmin();
  server.use(...admin.handlers);
  admin.seedDeck({
    id: memo,
    name: "Memo",
    visibility: "public",
    hidden: true,
    description: "연락 주세요 kakao",
    cards: [
      { id: "c1", front: contact, back: "답" },
      { id: "c2", front: "plain", back: "ok" },
    ],
  });
  admin.seedDeck({ id: plain, name: "Plain", visibility: "public", hidden: true });
  admin.holds.push(
    {
      deckId: memo,
      hold: "ai",
      hash: "h-memo",
      state: "held",
      findings: [
        {
          card_id: "c1",
          where: "front",
          block: 0,
          category: "phone",
          start: contact.indexOf("010"),
          end: contact.indexOf("010") + 13,
        },
        { card_id: null, where: "description", block: null, category: "contact", start: 0, end: 6 },
        // A block the deck does not hold: the category shows, no passage.
        { card_id: "c2", where: "back", block: 7, category: "link", start: 0, end: 2 },
      ],
    },
    { deckId: plain, hold: "reports", hash: "h-plain", state: "held", findings: [] },
  );
  setRequestCookies([...(await signedInCookies()), { name: "smartman-tz", value: "UTC" }]);
});

const held = () => render(NotesContent, { searchParams: Promise.resolve({ view: "held" }) });
const terms = () => render(NotesContent, { searchParams: Promise.resolve({ view: "terms" }) });

/** The held note named [name], as its list item. */
const item = (name: string) => {
  const queue = screen.getByRole("list", { name: "검토 중인 노트" });
  const found = within(queue)
    .getAllByRole("listitem")
    .find((candidate) => within(candidate).queryByRole("link", { name }) !== null);
  if (!found) throw new Error(`no held note ${name}`);
  return within(found);
};

describe("노트's 검토 중", () => {
  it("lists each held note with why it is held, what was found with the flagged words marked, and the two decisions", async () => {
    await held();
    expect(screen.getByRole("link", { name: "검토 중 2" })).toBeInTheDocument();
    const note = item("Memo");
    expect(note.getByText("자동 검토가 사람의 확인을 요청했어요")).toBeVisible();
    const found = note.getByRole("list", { name: "'Memo' 에서 찾은 것" });
    expect(
      within(found)
        .getAllByRole("listitem")
        .map((entry) => entry.textContent),
    ).toEqual([
      "전화번호 · 카드 앞면문의는 010-1234-5678 로",
      "연락처 안내 · 설명연락 주세요 kakao",
      "링크 · 카드 뒷면",
    ]);
    expect(Array.from(found.querySelectorAll("mark"), (mark) => mark.textContent)).toEqual([
      "010-1234-5678",
      "연락 주세요",
    ]);
    expect(note.getByRole("button", { name: "공개 허용" })).toBeVisible();
    expect(note.getByRole("button", { name: "숨김 유지" })).toBeVisible();
    // A note held for reports has nothing found, and says why it is held.
    const reported = item("Plain");
    expect(reported.getByText("신고가 쌓여 자동으로 숨겼어요")).toBeVisible();
    expect(reported.queryByRole("list")).not.toBeInTheDocument();
  });

  it("allows a held note after one confirmation, and refuses one the owner edited since", async () => {
    await held();
    await userEvent.click(item("Memo").getByRole("button", { name: "공개 허용" }));
    expect(
      screen.getByRole("group", { name: "'Memo' 노트를 공개할까요? 공개 목록에 바로 보여요." }),
    ).toBeVisible();
    // The owner edits it between the read and the click.
    admin.holds[0]!.hash = "h-edited";
    await userEvent.click(item("Memo").getByRole("button", { name: "공개 허용" }));
    expect(
      await screen.findByText("노트가 바뀌었어요. 새로 고쳐서 다시 확인해 주세요."),
    ).toBeVisible();
    expect(admin.decks.find((deck) => deck.id === memo)).toMatchObject({ hidden: true });
    expect(admin.audit).toEqual([]);

    // Control: the same action at the hash read goes through.
    admin.holds[0]!.hash = "h-memo";
    await userEvent.click(item("Memo").getByRole("button", { name: "공개 허용" }));
    await userEvent.click(item("Memo").getByRole("button", { name: "공개 허용" }));
    expect(await screen.findByText("노트를 공개했어요.")).toBeVisible();
    expect(admin.calls).toContain(`admin_allow_deck {"deck_id":"${memo}","content_hash":"h-memo"}`);
    expect(admin.decks.find((deck) => deck.id === memo)).toMatchObject({
      visibility: "public",
      hidden: false,
    });
    expect(admin.audit[0]).toMatchObject({ action: "allow_deck", target_id: memo });
  });

  it("keeps a held note hidden only with a reason, recording it", async () => {
    await held();
    await userEvent.click(item("Memo").getByRole("button", { name: "숨김 유지" }));
    expect(item("Memo").getByRole("button", { name: "숨김 유지" })).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox", { name: "숨기는 이유" }), "연락처 노출");
    await userEvent.click(item("Memo").getByRole("button", { name: "숨김 유지" }));
    expect(await screen.findByText("노트를 숨김으로 유지했어요.")).toBeVisible();
    expect(admin.calls).toContain(
      `admin_keep_deck_hidden {"deck_id":"${memo}","content_hash":"h-memo","reason":"연락처 노출"}`,
    );
    expect(admin.decks.find((deck) => deck.id === memo)).toMatchObject({ visibility: "private" });
    expect(admin.audit[0]).toMatchObject({
      action: "keep_deck_hidden",
      detail: { reason: "연락처 노출" },
    });
  });
});

describe("처리할 일's 검토 중인 노트", () => {
  it("shows the held notes with their findings and decisions, and nothing when none is held", async () => {
    await render(TodoContent, {});
    const section = screen.getByRole("region", { name: "검토 중인 노트" });
    expect(within(section).getByRole("link", { name: "Memo" })).toHaveAttribute(
      "href",
      `/decks/${memo}`,
    );
    expect(within(section).getAllByRole("button", { name: "공개 허용" })).toHaveLength(2);
    expect(section.querySelector("mark")).toHaveTextContent("010-1234-5678");

    cleanup();
    admin.holds.length = 0;
    await render(TodoContent, {});
    expect(screen.queryByRole("region", { name: "검토 중인 노트" })).not.toBeInTheDocument();
  });
});

describe("노트's 금칙어", () => {
  it("adds a word once however many times it is added, and removes one after a confirmation", async () => {
    await terms();
    expect(
      screen.getByText("금칙어가 없어요. 단어를 추가하거나 기본 목록을 불러오세요."),
    ).toBeVisible();
    await userEvent.type(screen.getByRole("textbox", { name: "금칙어 추가" }), "  나쁜말 ");
    await userEvent.click(screen.getByRole("button", { name: "추가" }));
    expect(await screen.findByText("금칙어를 추가했어요.")).toBeVisible();
    expect(admin.terms.map((entry) => entry.term)).toEqual(["나쁜말"]);
    await userEvent.type(screen.getByRole("textbox", { name: "금칙어 추가" }), "나쁜말");
    await userEvent.click(screen.getByRole("button", { name: "추가" }));
    await waitFor(() => {
      expect(
        admin.calls.filter((call) => call.startsWith("admin_add_screening_term")),
      ).toHaveLength(2);
    });
    expect(admin.terms).toHaveLength(1);

    cleanup();
    await terms();
    const list = within(screen.getByRole("list", { name: "금칙어 목록" }));
    expect(list.getByText("나쁜말")).toBeVisible();
    await userEvent.click(list.getByRole("button", { name: "'나쁜말' 삭제" }));
    expect(admin.terms).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(await screen.findByText("금칙어를 지웠어요.")).toBeVisible();
    expect(admin.terms).toEqual([]);
    expect(admin.audit.map((entry) => entry.action)).toEqual([
      "remove_screening_term",
      "add_screening_term",
    ]);
  });

  it("imports the bundled list one word at a time, skipping the words already there", async () => {
    admin.terms.push({ id: 100, term: screeningWords[0]!, created_at: "2026-10-19T03:00:00Z" });
    await terms();
    await userEvent.click(screen.getByRole("button", { name: "기본 목록 불러오기" }));
    await userEvent.click(screen.getByRole("button", { name: "불러오기" }));
    const added = screeningWords.length - 1;
    expect(await screen.findByText(`금칙어 ${String(added)}개를 추가했어요.`)).toBeVisible();
    expect(admin.terms.map((entry) => entry.term).sort()).toEqual([...screeningWords].sort());
    expect(admin.calls.filter((call) => call.startsWith("admin_add_screening_term"))).toHaveLength(
      added,
    );

    // Control: a second import has nothing to add and calls nothing.
    await userEvent.click(screen.getByRole("button", { name: "기본 목록 불러오기" }));
    await userEvent.click(screen.getByRole("button", { name: "불러오기" }));
    expect(await screen.findByText("목록의 금칙어가 이미 모두 들어 있어요.")).toBeVisible();
    expect(admin.terms).toHaveLength(screeningWords.length);
  });
});

describe("the bundled word list", () => {
  it("holds each word once, within the server's length, and none that is an ordinary word", () => {
    expect(new Set(screeningWords).size).toBe(screeningWords.length);
    for (const word of screeningWords) {
      expect(word).toBe(word.trim());
      expect(Array.from(word).length).toBeGreaterThanOrEqual(1);
      expect(Array.from(word).length).toBeLessThanOrEqual(100);
    }
    // Words the matcher would refuse in a note that is not abusive: a year, a station, a number.
    for (const ordinary of ["시발점", "병신년", "십팔", "노무사", "쪽발이", "화냥년", "뒤져라"]) {
      expect(screeningWords.filter((word) => ordinary.includes(word))).toEqual([]);
    }
  });

  it("holds no word that an ordinary phrase contains once the server's fold has dropped its separators", () => {
    // The server's fold: NFKC, lower case, and no space, punctuation, symbol or control mark.
    const folded = (text: string) =>
      Array.from(text.normalize("NFKC").toLowerCase())
        .filter((char) => !/^[\p{Z}\p{P}\p{S}\p{C}]$/u.test(char))
        .join("");
    const words = screeningWords.map(folded);
    const ordinary = [
      "고양이 새끼",
      "고양이 새끼야?",
      "개 같은 동물",
      "고전 소설에 나오는 창녀의 삶",
      "정부의 5개년 계획",
      "벌레가 죽어 버려서 치웠다",
      "적을 죽여 버리고 도망쳤다",
      "일제강점기에 조센징이라는 말은 멸칭이었다",
      "개 새끼",
      "세 시 팔 분",
      "씨 팔아요",
    ];
    for (const phrase of ordinary) {
      expect(
        words.filter((word) => folded(phrase).includes(word)),
        phrase,
      ).toEqual([]);
    }
    // Control: the check finds a word where a phrase does hold one.
    expect(words.filter((word) => folded("씨 발").includes(word))).toEqual(["씨발"]);
  });
});
