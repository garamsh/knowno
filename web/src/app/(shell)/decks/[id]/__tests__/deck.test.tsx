import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEngine } from "@/features/study";

import { cardRow, day, deckRow, reviewRow, side, start, stateRow, uuidOf } from "@/testing/library";
import { FakePostgrest } from "@/testing/mocks/postgrest";
import { supabaseUnreachable } from "@/testing/mocks/handlers";
import { server } from "@/testing/mocks/server";
import { setRequestCookies } from "@/testing/next-headers";
import { render } from "@/testing/render";
import { addByHand } from "@/testing/add-by-hand";
import { testRouter } from "@/testing/router";
import { signedInCookies } from "@/testing/session";
import { typeSizesOf } from "@/testing/type-sizes";
import { sensesUnder } from "@/testing/senses";
import { hatchedBlanksUnder } from "@/testing/whole-cards";

import { Deck } from "../_components/deck";
import { Study } from "../../../../study/_components/study";

// The study screen starts its session once the browser's engine has loaded; its first load
// compiles the module.
beforeAll(async () => {
  await loadEngine();
}, 30_000);

vi.mock("next/headers", () => import("@/testing/next-headers"));

/** Opens the page of the deck named [name]. */
const open = (name: string) => render(Deck, { params: Promise.resolve({ id: uuidOf(name) }) });

/** The page's one study link, "이 노트 학습 · n장". */
const studyLink = () => screen.getByRole("link", { name: /^이 노트 학습 · \d+장$/ });

/** What the page says of the deck: its card count over the cards, and today's cards for it. */
const summary = () => ({
  cards: /^카드 (\d+)$/.exec(
    screen.getByRole("heading", { level: 2, name: /^카드/ }).textContent,
  )?.[1],
  today: /(\d+)장/.exec(studyLink().textContent)?.[1],
});

/** The card search's field, always shown. */
const searchBox = () => screen.getByRole("searchbox", { name: "카드 검색" });

/** The cards on screen, each as its button names it: its front, and its answer. */
const rows = () =>
  within(screen.getByRole("region", { name: "카드" }))
    .queryAllByRole("button", { name: /, 뒷면 / })
    .map((card) => card.getAttribute("aria-label"));

describe("the deck page", () => {
  let postgrest: FakePostgrest;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(start);
    setRequestCookies(await signedInCookies());
    postgrest = new FakePostgrest();
    server.use(...postgrest.handlers);
    postgrest.seed("decks", deckRow("d-fr", "French"), deckRow("d-old", "Old", true));
    postgrest.seed(
      "cards",
      cardRow("c-chat", "d-fr", "Chat", 3 * day),
      cardRow("c-chien", "d-fr", "chien", 2 * day),
      cardRow("c-later", "d-fr", "oiseau", day),
      cardRow("c-gone", "d-fr", "maison", day, true),
    );
    postgrest.seed(
      "card_states",
      stateRow("c-chien", { stability: 3, difficulty: 5, lastReview: start - 4 * day, due: start }),
      stateRow("c-later", { stability: 9, difficulty: 5, lastReview: start, due: start + day }),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads why a refused note was refused with the note and shows it in its publish sheet, and reads nothing for a note not refused", async () => {
    postgrest.seed("decks", { ...deckRow("d-no", "Refused"), publication: "refused" });
    postgrest.refusals.set(uuidOf("d-no"), {
      refusal: "rules",
      findings: [{ card_id: "c", where: "front", block: 0, category: "phone", start: 0, end: 4 }],
    });
    await open("d-no");
    await userEvent.click(screen.getByRole("button", { name: "노트 설정" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "노트 공개" }));
    const sheet = within(screen.getByRole("dialog", { name: '"Refused" 공개' }));
    expect(sheet.getByText("전화번호가 들어 있어서 공개할 수 없어요.")).toBeVisible();
    expect(postgrest.requests.filter((r) => r === "POST rpc/my_deck_screening")).toHaveLength(1);
    cleanup();

    postgrest.requests.length = 0;
    await open("d-fr");
    await userEvent.click(screen.getByRole("button", { name: "노트 설정" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "노트 공개" }));
    expect(screen.queryByText(/공개할 수 없어요/)).not.toBeInTheDocument();
    expect(postgrest.requests).not.toContain("POST rpc/my_deck_screening");
  });

  it("shows the name, 이 노트 학습 at the top, and the live cards, oldest first", async () => {
    await open("d-fr");

    const name = screen.getByRole("heading", { level: 1, name: "French" });
    expect(name).toHaveClass("text-deck-name");
    expect(summary()).toEqual({ cards: "3", today: "2" });
    // The study link comes first under the name, before the cards.
    expect(
      name.compareDocumentPosition(studyLink()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      studyLink().compareDocumentPosition(screen.getByRole("region", { name: "카드" })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(studyLink()).toHaveAttribute("href", `/study?decks=${uuidOf("d-fr")}&from=deck`);
    expect(studyLink()).toHaveAttribute("aria-keyshortcuts", "Enter");
    // Every card whole, its answer read after its front.
    expect(rows()).toEqual([
      "Chat, 뒷면 Chat back",
      "chien, 뒷면 chien back",
      "oiseau, 뒷면 oiseau back",
    ]);
    expect(studyLink()).toHaveClass("bg-primary", "text-on-primary");
    // No tile, no white card and no way back: the name heads the page, and the menu leads home.
    expect(screen.queryByRole("region", { name: "오늘 학습" })).not.toBeInTheDocument();
    expect(document.querySelector('[class*="size-13"]')).toBeNull();
    expect(screen.queryByRole("navigation", { name: "위치" })).not.toBeInTheDocument();
  });

  it("puts 카드 추가 and 노트 설정 over the name on its own line and the card search, always shown, with no magnifier, leaving 이 노트 학습 the one primary", async () => {
    await open("d-fr");

    const header = screen.getByRole("heading", { level: 1, name: "French" }).closest("header");
    const settings = screen.getByRole("button", { name: "노트 설정" });
    expect(settings.closest("header")).toBe(header);
    // "카드 추가" is a button of the header beside it (#925), not an item of its menu.
    const add = screen.getByRole("button", { name: "카드 추가" });
    expect(add.closest("header")).toBe(header);
    expect(add).toHaveClass("bg-brand-tint");
    // The name has its own line under the actions, two lines at most.
    const name = screen.getByRole("heading", { level: 1, name: "French" });
    expect(settings.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(name.parentElement).toBe(header);
    expect(settings.parentElement?.contains(name)).toBe(false);
    expect(name).toHaveClass("line-clamp-2");
    // Its words kept whole, as our own Korean is, a word longer than the line still breaking.
    expect(name).toHaveClass("break-keep", "break-words");
    // The page's one primary fill is 이 노트 학습.
    expect([...document.querySelectorAll(".bg-primary")]).toEqual([studyLink()]);
    const search = screen.getByRole("searchbox", { name: "카드 검색" });
    expect(search.closest("header")).toBeNull();
    // Control: the header's buttons are 카드 추가 and 노트 설정; there is no magnifier.
    expect(
      within(header ?? document.body)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual([null, "노트 설정"]);
    expect(screen.queryByRole("button", { name: "카드 검색" })).not.toBeInTheDocument();
  });

  it('puts 노트 설정 on the surface beside the name, with the phone\'s five items, and "Anki로 내보내기" only on a note with cards', async () => {
    postgrest.seed("decks", deckRow("d-empty", "Empty"));
    for (const [name, title, exported] of [
      ["d-fr", "French", ["Anki로 내보내기"]],
      ["d-empty", "Empty", []],
    ] as const) {
      cleanup();
      await open(name);
      const settings = screen.getByRole("button", { name: "노트 설정" });
      expect(settings).toHaveClass("size-tap-target", "shadow-row", "bg-surface");
      expect(settings.closest("header")).toBe(
        screen.getByRole("heading", { level: 1, name: title }).closest("header"),
      );
      await userEvent.click(settings);
      expect(
        within(screen.getByRole("menu", { name: "노트 설정" }))
          .getAllByRole("menuitem")
          .map((item) => item.textContent),
      ).toEqual(["이름 바꾸기", "노트 꾸미기", "노트 공개", ...exported, "노트 삭제"]);
    }
  });

  it("opens the 카드 추가 sheet on arrival from 새 노트's 저장하고 카드 추가, and not otherwise", async () => {
    await open("d-fr");
    // Control: a plain arrival leaves the sheet closed.
    expect(screen.queryByRole("dialog", { name: "카드 추가" })).not.toBeInTheDocument();
    cleanup();

    await render(Deck, {
      params: Promise.resolve({ id: uuidOf("d-fr") }),
      searchParams: Promise.resolve({ adding: "1" }),
    });
    const sheet = within(screen.getByRole("dialog", { name: "카드 추가" }));
    // Its rows are their names alone, the four ways the web has.
    expect(
      sheet
        .getAllByRole("button")
        .filter((row) => row.getAttribute("aria-label") !== "닫기")
        .map((row) => row.textContent),
    ).toEqual(["직접 입력", "엑셀·CSV 파일"]);
    expect(
      ["사진 찍기", "앨범에서 고르기"].map(
        (name) => sheet.getByLabelText(name, { selector: "input" }).closest("label")?.textContent,
      ),
    ).toEqual(["사진 찍기", "앨범에서 고르기"]);
  });

  it("opens the 카드 추가 sheet from the header's 카드 추가", async () => {
    await open("d-fr");
    expect(screen.queryByRole("dialog", { name: "카드 추가" })).not.toBeInTheDocument();
    await addByHand();
    expect(screen.getByRole("dialog", { name: "카드 추가" })).toBeInTheDocument();
  });

  it("draws no 말랑이 at the edge, and no way to a chat from this note", async () => {
    window.localStorage.clear();
    await open("d-fr");
    expect(screen.queryByRole("button", { name: "말랑이와 대화하기" })).not.toBeInTheDocument();
    expect(screen.queryByText("말랑이를 누르면 언제든 대화할 수 있어요")).not.toBeInTheDocument();
  });

  it("draws the cards as one group of rows, each whole with its back on the hatch, and names the deck once", async () => {
    await open("d-fr");

    const list = within(screen.getByRole("region", { name: "카드" })).getByRole("list");
    expect(list).toHaveClass("rounded-group", "bg-surface", "divide-y", "divide-hairline");
    // No row draws a surface or a shadow of its own.
    for (const row of within(list).getAllByRole("listitem")) {
      expect(row.querySelector('[class*="bg-surface"], [class*="shadow"]')).toBeNull();
    }
    // The back is drawn after the front, on the hatch, and nothing hides it.
    const row = screen.getByRole("button", { name: "chien, 뒷면 chien back" });
    expect(row).toHaveTextContent(/^chienchien back$/);
    expect(row.querySelector("[data-hatched]")).toHaveTextContent(/^chien back$/);
    expect(row.querySelector("[data-hatched]")).toHaveClass("hatch");
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    // The section label alone above the cards, the count being under the deck's name.
    expect(screen.getByRole("heading", { level: 2, name: "카드 3" })).toBeInTheDocument();
    // The deck's name is its heading alone: the way back does not repeat it.
    expect(screen.getAllByText("French")).toHaveLength(1);
  });

  it("with no card left today still links 학습하기 · 0장 to the study page, which opens on nothing to study or on the completion sheet", async () => {
    postgrest.seed("decks", deckRow("d-done", "Done"));
    postgrest.seed("cards", cardRow("c-done", "d-done", "fini"));
    postgrest.seed(
      "card_states",
      stateRow("c-done", {
        stability: 9,
        difficulty: 5,
        lastReview: start - day,
        due: start + day,
      }),
    );
    // Answered yesterday: nothing was answered today.
    postgrest.seed("reviews", reviewRow("r-yesterday", "c-done", start - day, 1_000));

    for (const answered of ["yesterday", "today"]) {
      if (answered === "today") {
        postgrest.seed("reviews", reviewRow("r-today", "c-done", start - 3_600_000, 1_000));
      }
      await open("d-done");

      expect(summary(), answered).toEqual({ cards: "1", today: "0" });
      const href = studyLink().getAttribute("href");
      expect(href, answered).toBe(`/study?decks=${uuidOf("d-done")}&from=deck`);

      cleanup();
      await render(Study, {
        searchParams: Promise.resolve(Object.fromEntries(new URLSearchParams(href?.split("?")[1]))),
      });
      // The study screen starts once the browser's engine has loaded, under the skeleton.
      await waitFor(() => {
        expect(screen.queryByText("카드를 불러오는 중이에요.")).not.toBeInTheDocument();
      });
      if (answered === "yesterday") {
        expect(screen.getByText("오늘은 학습할 카드가 없어요")).toBeInTheDocument();
      } else {
        expect(screen.getByRole("dialog", { name: "오늘 학습을 다 했어요" })).toBeInTheDocument();
      }
      // Every way out, the close and the completion sheet's 완료, returns to this deck's page.
      expect(screen.getByRole("link", { name: "그만하기" }), answered).toHaveAttribute(
        "href",
        `/decks/${uuidOf("d-done")}`,
      );
      if (answered === "today") {
        await userEvent.setup().click(screen.getByRole("button", { name: "완료" }));
        await waitFor(() => {
          expect(testRouter.push).toHaveBeenCalledExactlyOnceWith(`/decks/${uuidOf("d-done")}`);
        });
      }
      cleanup();
    }
  });

  it("offers no 학습하기 on a deck with no card, which has nothing to study", async () => {
    // Control: the deck with cards links it.
    await open("d-fr");
    expect(studyLink()).toBeInTheDocument();
    cleanup();

    postgrest.seed("decks", deckRow("d-empty", "Empty"));
    await open("d-empty");
    expect(screen.getByRole("heading", { name: "Empty" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^이 노트 학습/ })).not.toBeInTheDocument();
  });

  it("shows an empty deck as the first run does, with the phone's words, 카드 추가 and 노트 설정 in the header and no search", async () => {
    postgrest.seed("decks", deckRow("d-empty", "Empty"));
    await open("d-empty");

    const empty = screen.getByRole("region", { name: "아직 카드가 없어요" });
    // Its way to add is the header's 카드 추가, as on a note with cards.
    expect(screen.getByRole("button", { name: "노트 설정" }).closest("header")).not.toBeNull();
    expect(screen.getByRole("button", { name: "카드 추가" }).closest("header")).not.toBeNull();
    expect(screen.queryByRole("searchbox", { name: "카드 검색" })).not.toBeInTheDocument();
    // The sleepy mascot over the words (ADR 0141).
    expect(empty.querySelector('img[src*="knowno-sleepy"]')).not.toBeNull();
    // Control: a deck with cards lists them instead, with no mascot, under the search.
    cleanup();
    await open("d-fr");
    expect(screen.getByRole("searchbox", { name: "카드 검색" })).toBeInTheDocument();
    expect(document.querySelector('img[src*="knowno-sleepy"]')).toBeNull();
    expect(screen.queryByRole("region", { name: "아직 카드가 없어요" })).not.toBeInTheDocument();
  });

  it("draws in three sizes, the title, the body and the caption, with its backs shown and with no card", async () => {
    await open("d-fr");
    // The state it asks for: every back shown.
    expect(rows()).toContain("Chat, 뒷면 Chat back");
    expect(typeSizesOf(document.body)).toEqual([13, 16, 28]);
    cleanup();

    postgrest.seed("decks", deckRow("d-empty", "Empty"));
    await open("d-empty");
    expect(screen.getByRole("region", { name: "아직 카드가 없어요" })).toBeInTheDocument();
    // An empty note is its name, one sentence and one action: it draws no caption.
    expect(typeSizesOf(document.body)).toEqual([16, 28]);
  });

  it("keeps a heading above a failed read, with 다시 시도", async () => {
    server.use(supabaseUnreachable);
    await open("d-fr");

    const heading = screen.getByRole("heading", { level: 1, name: "노트를 불러오지 못했어요" });
    const alert = screen.getByRole("alert");
    expect(heading.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(alert).toHaveTextContent("서버에 연결할 수 없어요.");
    expect(within(alert).getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });

  it("states its cards and those mastered once, over the cards, with no bar, and a deck with no card neither nor its study link", async () => {
    // One card past 21 days between its last review and its due day: mastered.
    postgrest.seed(
      "card_states",
      stateRow("c-chat", {
        stability: 40,
        difficulty: 5,
        lastReview: start,
        due: start + 30 * day,
      }),
    );
    await open("d-fr");
    expect(screen.getByRole("heading", { level: 2, name: "카드 3" })).toBeInTheDocument();
    expect(screen.getByText("1장 익힘")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    cleanup();

    postgrest.seed("decks", deckRow("d-empty", "Empty"));
    await open("d-empty");
    expect(screen.queryByRole("heading", { level: 2, name: /^카드/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^이 노트 학습/ })).not.toBeInTheDocument();
  });

  it("marks a deck its owner published with 공개 beside its mastered count", async () => {
    // Control: the private deck says no 공개.
    await open("d-fr");
    expect(screen.getByText("0장 익힘")).toBeInTheDocument();
    cleanup();

    postgrest.seed("decks", deckRow("d-pub", "Shared", false, "public"));
    postgrest.seed("cards", cardRow("c-pub", "d-pub", "pub"));
    await open("d-pub");
    expect(screen.getByRole("heading", { level: 1, name: "Shared" })).toBeInTheDocument();
    expect(screen.getByText("0장 익힘 · 공개")).toBeInTheDocument();
  });

  it("counts a backlog's reviews in its study link", async () => {
    // Four more due after 30 days: five due against a load of about 1.4 a day.
    const overdue = ["un", "deux", "trois", "quatre"];
    postgrest.seed("cards", ...overdue.map((front) => cardRow(`c-${front}`, "d-fr", front)));
    postgrest.seed(
      "card_states",
      ...overdue.map((front) =>
        stateRow(`c-${front}`, {
          stability: 30,
          difficulty: 5,
          lastReview: start - 31 * day,
          due: start - day,
        }),
      ),
    );
    await open("d-fr");

    expect(summary()).toEqual({ cards: "7", today: "5" });
  });

  it("keeps the cards whose front or back holds the search, ignoring case", async () => {
    await open("d-fr");
    const user = userEvent.setup();

    await user.type(searchBox(), "CH");
    expect(rows()).toEqual(["Chat, 뒷면 Chat back", "chien, 뒷면 chien back"]);
    expect(screen.getByRole("heading", { level: 2, name: "카드 3" })).toBeInTheDocument();

    await user.clear(searchBox());
    await user.type(searchBox(), "zèbre");
    expect(rows()).toEqual([]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "찾는 카드가 없어요. 다른 단어로 검색해 보세요.",
    );
  });

  it("opens a card in the editor on a click, as on the phone, and leaves every back as it was", async () => {
    await open("d-fr");
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "chien, 뒷면 chien back" }));
    const editor = screen.getByRole("dialog", { name: "카드 편집" });
    expect(within(editor).getByRole("textbox", { name: "앞면" })).toHaveValue("chien");
    expect(within(editor).getByRole("textbox", { name: "뒷면" })).toHaveValue("chien back");
    await user.click(within(editor).getByRole("button", { name: "닫기" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(rows()).toEqual([
      "Chat, 뒷면 Chat back",
      "chien, 뒷면 chien back",
      "oiseau, 뒷면 oiseau back",
    ]);
  });

  it("shows a vocabulary card's senses on the hatch, each label in brackets with a gap after it, a part of speech by its short form", async () => {
    postgrest.seed("cards", {
      ...cardRow("c-train", "d-fr", "train", day / 2),
      back: [
        {
          type: "senses",
          payload: {
            senses: [
              {
                labels: [
                  { kind: "part_of_speech", category: "noun", text: "n." },
                  { kind: "other", category: null, text: "사물" },
                ],
                meaning: "기차",
                examples: [],
              },
              { labels: [], meaning: "열차", examples: [] },
            ],
          },
        },
      ],
    });
    await open("d-fr");

    const card = screen.getByRole("button", { name: "train, 뒷면 [명] [사물] 기차\n열차" });
    expect(sensesUnder(card)).toEqual([
      { labels: ["[명]", "[사물]"], gapped: true, text: "[명][사물]기차" },
      { labels: [], gapped: true, text: "열차" },
    ]);
  });

  it("shows a whole card's sentence with its blank filled on the hatch", async () => {
    postgrest.seed("cards", {
      ...cardRow("c-cloze", "d-fr", "cloze", day / 2),
      front: [
        { type: "cloze", payload: { text: "The capital of France is ___", answers: ["Paris"] } },
      ],
      back: side("The capital of France is Paris"),
    });
    await open("d-fr");

    const filledCard = screen.getByRole("button", {
      name: "The capital of France is 빈칸, 뒷면 The capital of France is Paris",
    });
    expect(hatchedBlanksUnder(filledCard)).toEqual(["Paris"]);
  });

  it("searches a cloze card's every 칸, revealed, and reads its back after its filled sentence", async () => {
    // A back beside a blank that differs from the filled text is kept (ADR 0140).
    postgrest.seed("cards", {
      ...cardRow("c-cloze", "d-fr", "cloze", day / 2),
      front: [
        { type: "cloze", payload: { text: "The capital of Italy is ___", answers: ["Rome"] } },
      ],
      back: side("The capital of France is Paris"),
    });
    await open("d-fr");
    const user = userEvent.setup();
    const search = searchBox();
    // It reads as study draws it: its sentence filled, then what the reveal adds.
    const cloze =
      "The capital of Italy is 빈칸, 뒷면 The capital of Italy is Rome. The capital of France is Paris";

    // Its words find it, the blank's answer and the kept back among them.
    for (const word of ["italy", "Rome", "Paris"]) {
      await user.clear(search);
      await user.type(search, word);
      expect(rows()).toEqual([cloze]);
    }
    // Control: a word no 칸 holds finds nothing.
    await user.clear(search);
    await user.type(search, "Berlin");
    expect(rows()).toEqual([]);
    // Control: a split card's back is searched.
    await user.clear(search);
    await user.type(search, "chien back");
    expect(rows()).toEqual(["chien, 뒷면 chien back"]);
  });

  it("reads a whole card holding a block this build does not know by its 칸, its back blank among them", async () => {
    postgrest.seed("cards", {
      ...cardRow("c-unknown", "d-fr", "unknown", day / 2),
      front: side("Fill it"),
      back: [
        { type: "chart", payload: {} },
        { type: "cloze", v: 1, payload: { text: "___ is blue.", answers: ["Sky"] } },
      ],
    });
    await open("d-fr");

    expect(rows()).toContain(
      "Fill it. 빈칸 is blue.. [이 버전에서 표시할 수 없는 내용: chart], 뒷면 Fill it. Sky is blue.. [이 버전에서 표시할 수 없는 내용: chart]",
    );
    // Control: a split card's row reads its front, then its back.
    expect(rows()).toContain("Chat, 뒷면 Chat back");
  });

  it("lists and searches a free v2 card by its 칸, split and whole, as the same card stored earlier", async () => {
    const glue = (front: string, back: string) => ({
      type: "text",
      v: 2,
      payload: { front, back },
    });
    postgrest.seed(
      "cards",
      {
        ...cardRow("c-glue", "d-fr", "glue", day / 2),
        front: [glue("Lyon", "a city")],
        back: [],
        template: "free",
        template_version: 2,
      },
      {
        ...cardRow("c-blank", "d-fr", "blank", day / 2),
        front: [
          glue("Colour", "A hue."),
          { type: "cloze", v: 1, payload: { text: "___ is red.", answers: ["Rose"] } },
          glue("", "A flower."),
        ],
        back: [],
        template: "free",
        template_version: 2,
      },
      // The earlier form of the same blanked card: a back alone holding a blank (#482).
      {
        ...cardRow("c-earlier", "d-fr", "earlier", day / 2),
        front: side("Fill it"),
        back: [{ type: "cloze", v: 1, payload: { text: "___ is blue.", answers: ["Sky"] } }],
      },
    );
    await open("d-fr");
    // The read asks for the template: the fake answers whole rows whatever is selected.
    expect(postgrest.selected).toContain(
      "cards: id,deck_id,front,back,template,template_version,created_at",
    );
    const user = userEvent.setup();
    const search = searchBox();

    await user.type(search, "a city");
    expect(rows()).toEqual(["Lyon, 뒷면 a city"]);
    // Every 칸 is searched, a part only the reveal adds and a blank's answer among them.
    for (const word of ["A hue", "A flower", "Rose"]) {
      await user.clear(search);
      await user.type(search, word);
      expect(rows()).toEqual([
        "Colour. 빈칸 is red., 뒷면 Colour. A hue.. Rose is red.. A flower.",
      ]);
    }
    await user.clear(search);
    await user.type(search, "Sky");
    expect(rows()).toEqual(["Fill it. 빈칸 is blue., 뒷면 Fill it. Sky is blue."]);

    await user.clear(search);
    expect(rows()).toContain("Lyon, 뒷면 a city");
    expect(rows()).toContain("Colour. 빈칸 is red., 뒷면 Colour. A hue.. Rose is red.. A flower.");
    expect(rows()).toContain("Fill it. 빈칸 is blue., 뒷면 Fill it. Sky is blue.");
    const blanked = screen.getByRole("button", {
      name: "Fill it. 빈칸 is blue., 뒷면 Fill it. Sky is blue.",
    });
    expect(hatchedBlanksUnder(blanked)).toEqual(["Sky"]);
  });

  it("has no 뒷면 보기 switch: every back is shown when the page opens", async () => {
    await open("d-fr");
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByText("뒷면 보기")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "카드 3" })).toBeInTheDocument();
    expect(rows()).toEqual([
      "Chat, 뒷면 Chat back",
      "chien, 뒷면 chien back",
      "oiseau, 뒷면 oiseau back",
    ]);
  });

  it("is not found for a deleted deck, and found for a live one", async () => {
    await expect(open("d-old")).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    await expect(open("d-fr")).resolves.toBeDefined();
  });

  it("is not found for an address id that is not a uuid, and found for the deck's own id", async () => {
    await expect(render(Deck, { params: Promise.resolve({ id: "d-fr" }) })).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
    // Control: the same deck by its uuid opens.
    await open("d-fr");
    expect(screen.getByRole("heading", { name: "French" })).toBeInTheDocument();
  });
});
