import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEngine } from "@/features/study";

import { cardRow, day, deckRow, reviewRow, side, start, stateRow, uuidOf } from "@/testing/library";
import { FakePostgrest } from "@/testing/mocks/postgrest";
import { supabaseUnreachable } from "@/testing/mocks/handlers";
import { server } from "@/testing/mocks/server";
import { setRequestCookies } from "@/testing/next-headers";
import { expectTextReadable } from "@/testing/contrast";
import { render } from "@/testing/render";
import { signedInCookies } from "@/testing/session";
import { typeSizesOf } from "@/testing/type-sizes";
import { sensesUnder } from "@/testing/senses";
import { blanksUnder } from "@/testing/whole-cards";

import { Deck } from "../_components/deck";
import { Study } from "../../../../study/_components/study";

// The study screen starts its session once the browser's engine has loaded; its first load
// compiles the module.
beforeAll(async () => {
  await loadEngine();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
}, 30_000);

vi.mock("next/headers", () => import("@/testing/next-headers"));

/** Opens the page of the deck named [name]. */
const open = (name: string) => render(Deck, { params: Promise.resolve({ id: uuidOf(name) }) });

/** What the page says of the deck: its card count under the name, and today's cards for it. */
const summary = () => ({
  cards: /카드 (\d+)장/.exec(screen.getByRole("banner").textContent)?.[1],
  today: /오늘 할 카드 (\d+)장/.exec(
    within(screen.getByRole("region", { name: "오늘 학습" }))
      .getByLabelText(/^오늘 할 카드/)
      .getAttribute("aria-label") ?? "",
  )?.[1],
});

/** The cards on screen, each as its button names it: its front, and its answer or that it is hidden. */
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

  it("shows the name, today's line, the study button and the live cards, oldest first", async () => {
    await open("d-fr");

    expect(screen.getByRole("heading", { name: "French" })).toBeInTheDocument();
    expect(summary()).toEqual({ cards: "3", today: "2" });
    expect(screen.getByRole("link", { name: "학습하기" })).toHaveAttribute(
      "href",
      `/study?decks=${uuidOf("d-fr")}&from=deck`,
    );
    expect(screen.getByRole("link", { name: "학습하기" })).toHaveAttribute(
      "aria-keyshortcuts",
      "Enter",
    );
    // Every answer hidden until it is asked for.
    expect(rows()).toEqual(["Chat, 뒷면 가려짐", "chien, 뒷면 가려짐", "oiseau, 뒷면 가려짐"]);
    // The white card "오늘 학습": the minutes at its right, the count with its unit, and its button.
    const card = screen.getByRole("region", { name: "오늘 학습" });
    expect(card).toHaveClass("bg-surface", "text-ink", "shadow-card");
    expect(card).toHaveTextContent(/^오늘 학습약 \d+분2장학습하기/);
    expect(screen.getByRole("link", { name: "학습하기" })).toHaveClass(
      "bg-primary",
      "text-on-primary",
    );
    expectTextReadable(card);
    expect(screen.getByRole("link", { name: "덱" })).toHaveAttribute("href", "/decks");
  });

  it("draws the cards as one group of rows, a hidden back as nothing, and names the deck once", async () => {
    await open("d-fr");

    const list = within(screen.getByRole("region", { name: "카드" })).getByRole("list");
    expect(list).toHaveClass("rounded-group", "bg-surface", "divide-y", "divide-hairline");
    // No row draws a surface or a shadow of its own.
    for (const row of within(list).getAllByRole("listitem")) {
      expect(row.querySelector('[class*="bg-surface"], [class*="shadow"]')).toBeNull();
    }
    // A hidden back is nothing: the row draws its front alone.
    const hidden = screen.getByRole("button", { name: "chien, 뒷면 가려짐" });
    expect(hidden).toHaveTextContent(/^chien$/);
    expect(hidden.querySelector('[class*="bg-"]')).toBeNull();
    await userEvent.setup().click(screen.getByRole("switch", { name: "뒷면 보기" }));
    // Control: a shown back is drawn after the front.
    expect(screen.getByRole("button", { name: "chien, 뒷면 chien back" })).toHaveTextContent(
      /^chienchien back$/,
    );
    // The section label alone above the cards, the count being under the deck's name.
    expect(screen.getByRole("heading", { level: 2, name: "카드" })).toBeInTheDocument();
    // The deck's name is its heading alone: the way back does not repeat it.
    expect(screen.getAllByText("French")).toHaveLength(1);
  });

  it("with no card left today still links 학습하기 · 0장 to the study page, which opens on nothing to study or on the completion card", async () => {
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
      const href = screen.getByRole("link", { name: "학습하기" }).getAttribute("href");
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
        expect(screen.getByRole("region", { name: "오늘 학습 완료" })).toBeInTheDocument();
      }
      // Every 그만하기, the close and the completion card's, returns to this deck's page.
      const ways = screen.getAllByRole("link", { name: "그만하기" });
      expect(ways.length, answered).toBe(answered === "yesterday" ? 1 : 2);
      for (const way of ways) {
        expect(way, answered).toHaveAttribute("href", `/decks/${uuidOf("d-done")}`);
      }
      cleanup();
    }
  });

  it("offers no 학습하기 on a deck with no card, which has nothing to study", async () => {
    // Control: the deck with cards links it.
    await open("d-fr");
    expect(screen.getByRole("link", { name: "학습하기" })).toBeInTheDocument();
    cleanup();

    postgrest.seed("decks", deckRow("d-empty", "Empty"));
    await open("d-empty");
    expect(screen.getByRole("heading", { name: "Empty" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "학습하기" })).not.toBeInTheDocument();
  });

  it("shows an empty deck as the first run does, with the phone's words and where cards are added", async () => {
    postgrest.seed("decks", deckRow("d-empty", "Empty"));
    await open("d-empty");

    const empty = screen.getByRole("region", { name: "아직 카드가 없어요" });
    // Its one action is the page's coral fill.
    expect(screen.getByRole("button", { name: "카드 추가" })).toHaveClass("bg-primary");
    expect(screen.queryByRole("searchbox", { name: "카드 검색" })).not.toBeInTheDocument();
    // The sleepy mascot over the words (ADR 0141).
    expect(empty.querySelector('img[src*="knowno-sleepy"]')).not.toBeNull();
    // Control: a deck with cards lists them instead, with no mascot.
    cleanup();
    await open("d-fr");
    expect(screen.getByRole("button", { name: "카드 추가" })).not.toHaveClass("bg-primary");
    expect(document.querySelector('img[src*="knowno-sleepy"]')).toBeNull();
    expect(screen.queryByRole("region", { name: "아직 카드가 없어요" })).not.toBeInTheDocument();
  });

  it("draws in three sizes, the title, the body and the caption, with its backs hidden or shown and with no card", async () => {
    await open("d-fr");
    expect(typeSizesOf(document.body)).toEqual([13, 16, 28]);
    await userEvent.setup().click(screen.getByRole("switch", { name: "뒷면 보기" }));
    // The state it asked for: every back shown.
    expect(rows()).toContain("Chat, 뒷면 Chat back");
    expect(typeSizesOf(document.body)).toEqual([13, 16, 28]);
    cleanup();

    postgrest.seed("decks", deckRow("d-empty", "Empty"));
    await open("d-empty");
    expect(screen.getByRole("region", { name: "아직 카드가 없어요" })).toBeInTheDocument();
    expect(typeSizesOf(document.body)).toEqual([13, 16, 28]);
  });

  it("keeps the way back to 덱 and a heading above a failed read, with 다시 시도", async () => {
    server.use(supabaseUnreachable);
    await open("d-fr");

    expect(
      within(screen.getByRole("navigation", { name: "위치" })).getByRole("link", { name: "덱" }),
    ).toHaveAttribute("href", "/decks");
    const heading = screen.getByRole("heading", { level: 1, name: "덱을 불러오지 못했어요" });
    const alert = screen.getByRole("alert");
    expect(heading.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(alert).toHaveTextContent("서버에 연결할 수 없어요.");
    expect(within(alert).getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });

  it("states its cards and those mastered once, under its name, with no bar, and a deck with no card its cards alone and no white card", async () => {
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
    expect(screen.getByText("카드 3장 · 익힌 카드 1장")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByText(/익힘/)).not.toBeInTheDocument();
    cleanup();

    postgrest.seed("decks", deckRow("d-empty", "Empty"));
    await open("d-empty");
    expect(screen.getByText("카드 0장")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "오늘 학습" })).not.toBeInTheDocument();
  });

  it("draws the tile the server's icon and colour keys name, and layers on the brand tint for keys it does not know", async () => {
    /** The header tile's fill and its icon's Lucide name. */
    const tile = () => {
      const box = screen.getByRole("banner").querySelector("[aria-hidden]");
      return {
        fill: box?.className.split(" ").find((name) => name.startsWith("bg-")),
        icon: box
          ?.querySelector("svg")
          ?.getAttribute("class")
          ?.split(" ")
          .find((name) => name.startsWith("lucide-")),
      };
    };
    postgrest.seed(
      "decks",
      { ...deckRow("d-tiled", "Tiled"), icon: "book", color: "violet" },
      { ...deckRow("d-newer", "Newer"), icon: "rocket", color: "teal" },
    );

    await open("d-tiled");
    expect(tile()).toEqual({ icon: "lucide-book-open", fill: "bg-deck-violet" });
    // The read asks for both keys: the fake answers whole rows whatever is selected.
    expect(postgrest.selected.filter((read) => read.startsWith("decks: "))).toContain(
      "decks: id,name,visibility,icon,color",
    );
    cleanup();
    await open("d-newer");
    // A key this version does not know is no choice, so the tile is the brand tint.
    expect(tile()).toEqual({ icon: "lucide-layers", fill: "bg-brand-tint" });
  });

  it("marks a deck its owner published with 공개 under its name", async () => {
    // Control: the private deck carries no chip.
    await open("d-fr");
    expect(screen.getByRole("heading", { name: "French" })).toBeInTheDocument();
    expect(screen.getByText("카드 3장 · 익힌 카드 0장")).toBeInTheDocument();
    cleanup();

    postgrest.seed("decks", deckRow("d-pub", "Shared", false, "public"));
    await open("d-pub");
    expect(screen.getByRole("heading", { name: "Shared" })).toBeInTheDocument();
    expect(screen.getByText("카드 0장 · 공개")).toBeInTheDocument();
  });

  it("says new cards wait while more than three days of reviews are due, and not otherwise", async () => {
    const paused = "밀린 복습을 마칠 때까지 새 카드는 쉬어요.";
    // Control: one card due every four days and one every day are not a backlog.
    await open("d-fr");
    expect(summary()).toEqual({ cards: "3", today: "2" });
    expect(screen.queryByText(paused)).not.toBeInTheDocument();
    cleanup();

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
    expect(screen.getByText(paused)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "학습하기" })).toBeInTheDocument();
  });

  it("keeps the cards whose front or back holds the search, ignoring case", async () => {
    await open("d-fr");
    const user = userEvent.setup();

    await user.type(screen.getByRole("searchbox", { name: "카드 검색" }), "CH");
    expect(rows()).toEqual(["Chat, 뒷면 가려짐", "chien, 뒷면 가려짐"]);
    // The results follow the switch.
    await user.click(screen.getByRole("switch", { name: "뒷면 보기" }));
    expect(rows()).toEqual(["Chat, 뒷면 Chat back", "chien, 뒷면 chien back"]);
    expect(screen.getByRole("heading", { name: "카드" })).toBeInTheDocument();

    await user.clear(screen.getByRole("searchbox", { name: "카드 검색" }));
    await user.type(screen.getByRole("searchbox", { name: "카드 검색" }), "zèbre");
    expect(rows()).toEqual([]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "찾는 카드가 없어요. 다른 단어로 검색해 보세요.",
    );
  });

  it("opens a card in the editor on a click, as on the phone, and leaves every back as it was", async () => {
    await open("d-fr");
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "chien, 뒷면 가려짐" }));
    const editor = screen.getByRole("dialog", { name: "카드 편집" });
    expect(within(editor).getByRole("textbox", { name: "앞면" })).toHaveValue("chien");
    expect(within(editor).getByRole("textbox", { name: "뒷면" })).toHaveValue("chien back");
    await user.click(within(editor).getByRole("button", { name: "닫기" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(rows()).toEqual(["Chat, 뒷면 가려짐", "chien, 뒷면 가려짐", "oiseau, 뒷면 가려짐"]);
  });

  it("shows a vocabulary card's senses with 뒷면 보기, each label in brackets with a gap after it, a part of speech by its short form", async () => {
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

    await userEvent.setup().click(screen.getByRole("switch", { name: "뒷면 보기" }));
    const card = screen.getByRole("button", { name: "train, 뒷면 [명] [사물] 기차\n열차" });
    expect(sensesUnder(card)).toEqual([
      { labels: ["[명]", "[사물]"], gapped: true, text: "[명][사물]기차" },
      { labels: [], gapped: true, text: "열차" },
    ]);
  });

  it("shows a whole card's front with its blank empty, and fills it with 뒷면 보기", async () => {
    postgrest.seed("cards", {
      ...cardRow("c-cloze", "d-fr", "cloze", day / 2),
      front: [
        { type: "cloze", payload: { text: "The capital of France is ___", answers: ["Paris"] } },
      ],
      back: side("The capital of France is Paris"),
    });
    await open("d-fr");
    const user = userEvent.setup();

    const hidden = screen.getByRole("button", {
      name: "The capital of France is 빈칸, 뒷면 가려짐",
    });
    expect(blanksUnder(hidden)).toEqual({ Paris: false });
    await user.click(screen.getByRole("switch", { name: "뒷면 보기" }));
    const filledCard = screen.getByRole("button", {
      name: "The capital of France is 빈칸, 뒷면 The capital of France is Paris",
    });
    expect(blanksUnder(filledCard)).toEqual({ Paris: true });
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
    const search = screen.getByRole("searchbox", { name: "카드 검색" });
    const cloze = "The capital of Italy is 빈칸, 뒷면 가려짐";

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
    expect(rows()).toEqual(["chien, 뒷면 가려짐"]);

    // Shown, it reads as study draws it: its sentence filled, then what the reveal adds.
    await user.clear(search);
    await user.click(screen.getByRole("switch", { name: "뒷면 보기" }));
    expect(rows()).toContain(
      "The capital of Italy is 빈칸, 뒷면 The capital of Italy is Rome. The capital of France is Paris",
    );
    expect(rows()).toContain("Chat, 뒷면 Chat back");
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
      "Fill it. 빈칸 is blue.. [이 버전에서 표시할 수 없는 내용: chart], 뒷면 가려짐",
    );
    // Control: a split card's row reads its front alone.
    expect(rows()).toContain("Chat, 뒷면 가려짐");
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
    const search = screen.getByRole("searchbox", { name: "카드 검색" });

    await user.type(search, "a city");
    expect(rows()).toEqual(["Lyon, 뒷면 가려짐"]);
    // Every 칸 is searched, a part only the reveal adds and a blank's answer among them.
    for (const word of ["A hue", "A flower", "Rose"]) {
      await user.clear(search);
      await user.type(search, word);
      expect(rows()).toEqual(["Colour. 빈칸 is red., 뒷면 가려짐"]);
    }
    await user.clear(search);
    await user.type(search, "Sky");
    expect(rows()).toEqual(["Fill it. 빈칸 is blue., 뒷면 가려짐"]);

    await user.clear(search);
    await user.click(screen.getByRole("switch", { name: "뒷면 보기" }));
    expect(rows()).toContain("Lyon, 뒷면 a city");
    expect(rows()).toContain("Colour. 빈칸 is red., 뒷면 Colour. A hue.. Rose is red.. A flower.");
    expect(rows()).toContain("Fill it. 빈칸 is blue., 뒷면 Fill it. Sky is blue.");
    const blanked = screen.getByRole("button", {
      name: "Fill it. 빈칸 is blue., 뒷면 Fill it. Sky is blue.",
    });
    expect(blanksUnder(blanked)).toEqual({ Sky: true });
    // Control: hidden, the same card's blank is empty.
    await user.click(screen.getByRole("switch", { name: "뒷면 보기" }));
    expect(
      blanksUnder(screen.getByRole("button", { name: "Fill it. 빈칸 is blue., 뒷면 가려짐" })),
    ).toEqual({ Sky: false });
  });

  it("shows or hides every back with 뒷면 보기, off when the page opens", async () => {
    await open("d-fr");
    const user = userEvent.setup();
    const answers = screen.getByRole("switch", { name: "뒷면 보기" });
    expect(answers).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("heading", { name: "카드" })).toBeInTheDocument();

    await user.click(answers);
    expect(answers).toHaveAttribute("aria-checked", "true");
    expect(rows()).toEqual([
      "Chat, 뒷면 Chat back",
      "chien, 뒷면 chien back",
      "oiseau, 뒷면 oiseau back",
    ]);
    await user.click(answers);
    expect(rows()).toEqual(["Chat, 뒷면 가려짐", "chien, 뒷면 가려짐", "oiseau, 뒷면 가려짐"]);
  });

  it("leads back to 덱 with a chevron, on a target at least the tap target high and wide", async () => {
    await open("d-fr");

    const back = within(screen.getByRole("navigation", { name: "위치" })).getByRole("link", {
      name: "덱",
    });
    expect(back).toHaveAttribute("href", "/decks");
    expect(back.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(back.className.split(" ")).toEqual(
      expect.arrayContaining(["min-h-tap-target", "min-w-tap-target"]),
    );
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
