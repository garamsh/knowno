import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEngine } from "@/features/study";

import { FakePostgrest } from "@/testing/mocks/postgrest";
import { otherUser, supabaseUnreachable, testUser } from "@/testing/mocks/handlers";
import { server } from "@/testing/mocks/server";
import { cardRow, day, deckRow, reviewRow, start, stateRow, uuidOf } from "@/testing/library";
import { setRequestCookies } from "@/testing/next-headers";
import { render } from "@/testing/render";
import { chipTone } from "@/testing/chip";
import { signedInCookies } from "@/testing/session";
import { typeSizesOf } from "@/testing/type-sizes";

import { Study } from "../../study/_components/study";
import { Notes } from "../decks/_components/notes";
import { Today } from "../_components/today";

/** 홈 and the 노트 page, one above the other, as the two pages read the same library. */
const renderBoth = () =>
  render(
    async () => (
      <>
        {await Today()}
        {await Notes()}
      </>
    ),
    {},
  );

/** The 노트 page alone. */
const renderNotes = () => render(Notes, {});

// The study screen starts its session once the browser's engine has loaded; its first load
// compiles the module.
beforeAll(async () => {
  await loadEngine();
}, 30_000);

vi.mock("next/headers", () => import("@/testing/next-headers"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const due = { stability: 3, difficulty: 5, lastReview: start - 4 * day, due: start - day };
const notDue = { stability: 30, difficulty: 5, lastReview: start - day, due: start + 9 * day };

describe("홈 and the 노트 page", () => {
  let postgrest: FakePostgrest;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(start);
    setRequestCookies(await signedInCookies());
    postgrest = new FakePostgrest();
    server.use(...postgrest.handlers);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** The row of the deck named [name]: a link named for the deck, its count and its chip. */
  const deckList = () => within(screen.getByRole("region", { name: "노트 목록" }));
  const row = (name: string) =>
    deckList().getByRole("link", { name: new RegExp(`^${name}, 카드`) });
  /** The hero's cards left today and their minutes, as drawn: "오늘 n장 · 약 m분이면 끝나요". */
  const todayLine = () =>
    `${document.getElementById("hero-title")?.textContent ?? ""} · ${
      document.getElementById("hero-time")?.textContent ?? ""
    }`;
  /** The cards left today, as the hero counts them. */
  const cardsLeft = () => Number(/^오늘 (\d+)장/.exec(todayLine())?.[1]);
  /** The deck rows' names, without the progress each ends with. */
  const rowNames = () =>
    deckList()
      .getAllByRole("link")
      .map((link) => link.getAttribute("aria-label")?.replace(/, \d+장 중 \d+장 익힘, .*$/, ""));

  it("shows the server's decks by name, with their card counts and today's chips", async () => {
    postgrest.seed("decks", deckRow("d-es", "Spanish"), deckRow("d-fr", "French"));
    postgrest.seed(
      "cards",
      cardRow("fr-new", "d-fr", "chat"),
      cardRow("fr-due", "d-fr", "chien"),
      cardRow("fr-later", "d-fr", "oiseau"),
      cardRow("es-later", "d-es", "gato"),
    );
    postgrest.seed("card_states", stateRow("fr-due", due), stateRow("fr-later", notDue));
    postgrest.seed("card_states", stateRow("es-later", notDue));

    await renderBoth();

    // The sky, on the hero's colour under the app's name, holds the day alone; 시작, the one
    // primary, is on the ground under it.
    const hero = screen.getByRole("region", { name: "오늘 2장" });
    expect(hero).toHaveClass("bg-hero", "text-on-hero");
    expect(within(hero).getByRole("heading", { level: 1, name: "알아몰라" })).toBeInTheDocument();
    const start = screen.getByRole("link", { name: "시작" });
    expect(start).toHaveClass("bg-primary", "text-on-primary");
    expect(hero).not.toContainElement(start);
    expect(hero.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(todayLine()).toBe("오늘 2장 · 약 1분이면 끝나요");
    expect(screen.getByRole("link", { name: "시작" })).toHaveAttribute(
      "href",
      `/study?decks=${uuidOf("d-fr")},${uuidOf("d-es")}`,
    );
    expect(screen.getByRole("heading", { level: 1, name: "노트" })).toBeInTheDocument();
    expect(rowNames()).toEqual(["French, 카드 3장, 오늘 2", "Spanish, 카드 1장"]);
    expect(row("French")).toHaveAttribute("href", `/decks/${uuidOf("d-fr")}`);
  });

  it("counts the new cards left today across every deck, in the time zone the browser's cookie names", async () => {
    postgrest.seed("decks", deckRow("d-a", "Alpha"), deckRow("d-b", "Beta"));
    // 5 minutes at 10 s a card, the pace while too few answers are stored: 30 new cards a day.
    postgrest.studySettings.set(testUser.id, {
      daily_minutes: 5,
      updated_at: new Date(start).toISOString(),
    });
    postgrest.seed(
      "cards",
      ...Array.from({ length: 35 }, (_, index) =>
        cardRow(`a${String(index)}`, "d-a", `alpha ${String(index)}`),
      ),
      cardRow("b-answered", "d-b", "beta"),
    );
    // Beta's card was first answered at 15:00 UTC the day before: 00:00 in Seoul, the day
    // before that study day; 07:00 in Los Angeles, inside the study day there.
    const answeredAt = start - 18 * 3_600_000;
    postgrest.seed("card_states", stateRow("b-answered", { ...notDue, lastReview: answeredAt }));
    postgrest.seed("reviews", reviewRow("r1", "b-answered", answeredAt, 1_000));

    // Without the cookie the day is read in Seoul.
    await renderBoth();
    expect(cardsLeft()).toBe(30);
    cleanup();

    setRequestCookies([
      ...(await signedInCookies()),
      { name: "smartman-tz", value: "America/Los_Angeles" },
    ]);
    await renderBoth();
    expect(cardsLeft()).toBe(29);
    expect(rowNames()).toEqual(["Alpha, 카드 35장, 오늘 29", "Beta, 카드 1장"]);
  });

  it("in a backlog draws the phone's backlog card and its catch-up, and not otherwise", async () => {
    const title = "다시 시작하면 돼요";
    postgrest.seed("decks", deckRow("d-fr", "French"));
    postgrest.seed("cards", cardRow("fr-new", "d-fr", "chat"), cardRow("fr-due", "d-fr", "chien"));
    postgrest.seed("card_states", stateRow("fr-due", due));
    // Control: one card due every three days is not a backlog, so the today card shows.
    await renderBoth();
    expect(todayLine()).toBe("오늘 2장 · 약 1분이면 끝나요");
    expect(screen.queryByRole("heading", { name: title })).not.toBeInTheDocument();
    cleanup();

    // Two more due after 30 days: three due against a load of about 0.4 a day.
    const overdue = {
      stability: 30,
      difficulty: 5,
      lastReview: start - 31 * day,
      due: start - day,
    };
    postgrest.seed("cards", cardRow("fr-a", "d-fr", "un"), cardRow("fr-b", "d-fr", "deux"));
    postgrest.seed("card_states", stateRow("fr-a", overdue), stateRow("fr-b", overdue));
    await renderBoth();

    // The sky states the backlog in place of the day's count, with 시작 over every note.
    const backlog = screen.getByRole("region", { name: title });
    const hero = within(backlog);
    expect(backlog).toHaveClass("bg-hero", "text-on-hero");
    expect(backlog.querySelector('img[src*="knowno-thinking"]')).not.toBeNull();
    expect(
      hero.getByText("밀린 복습 3장을 급한 것부터 해요. 새 카드는 잠시 쉬어요."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "시작" })).toHaveAttribute(
      "href",
      `/study?decks=${uuidOf("d-fr")}`,
    );
    expect(document.getElementById("hero-time")).toBeNull();
    // The catch-up chart and the last seven days have left 홈; 기록 holds the record.
    expect(screen.queryByText(/따라잡아요/)).not.toBeInTheDocument();
    expect(screen.queryByText("지난 7일")).not.toBeInTheDocument();
  });

  it("leaves out tombstoned decks and cards, and the cards of a tombstoned deck", async () => {
    postgrest.seed("decks", deckRow("d-fr", "French"), deckRow("d-old", "Old", true));
    postgrest.seed(
      "cards",
      cardRow("fr-live", "d-fr", "chat"),
      cardRow("fr-gone", "d-fr", "chien", day, true),
      cardRow("old-live", "d-old", "maison"),
    );

    await renderBoth();

    expect(screen.queryByText("Old")).not.toBeInTheDocument();
    expect(rowNames()).toEqual(["French, 카드 1장, 오늘 1"]);
    expect(cardsLeft()).toBe(1);
    // Control: the live deck and its live card are read and shown.
    expect(screen.getByRole("heading", { level: 1, name: "노트" })).toBeInTheDocument();
  });

  it("leaves out another user's public deck, which row-level security lets it read", async () => {
    const other = otherUser.id;
    postgrest.seed("decks", deckRow("d-fr", "French"), {
      ...deckRow("d-pub", "Public"),
      user_id: other,
      visibility: "public",
    });
    postgrest.seed("cards", cardRow("fr", "d-fr", "chat"), {
      ...cardRow("pub", "d-pub", "maison"),
      user_id: other,
    });

    await renderBoth();

    // Control: the user's own deck is read and counted.
    expect(rowNames()).toEqual(["French, 카드 1장, 오늘 1"]);
    expect(cardsLeft()).toBe(1);
  });

  it("estimates the minutes from the user's review and first-answer paces, each answer counted up to 30 s", async () => {
    postgrest.seed("decks", deckRow("d-fr", "French"));
    postgrest.seed(
      "cards",
      ...["un", "deux", "trois"].map((front) => cardRow(`due-${front}`, "d-fr", front)),
      ...["quatre", "cinq", "six", "sept"].map((front) => cardRow(`new-${front}`, "d-fr", front)),
    );
    postgrest.seed(
      "card_states",
      ...["un", "deux", "trois"].map((front) => stateRow(`due-${front}`, due)),
    );
    // Yesterday, twenty cards first answered in 90 s, which counts 30, and reviewed in 24 s.
    const history = (reviews: number) =>
      Array.from({ length: 20 }, (_, index) => [
        reviewRow(`first-${String(index)}`, `h-${String(index)}`, start - day, 90_000),
        ...(index < reviews
          ? [reviewRow(`review-${String(index)}`, `h-${String(index)}`, start - day + 1000, 24_000)]
          : []),
      ]).flat();
    // Control: with 19 reviews the review pace is unknown, 10 s: 3 at 10 s and 4 at 30 s.
    postgrest.seed("reviews", ...history(19));
    await renderBoth();
    expect(todayLine()).toBe("오늘 7장 · 약 3분이면 끝나요");
    cleanup();

    // The twentieth review: 3 at 24 s and 4 at 30 s.
    postgrest.seed("reviews", ...history(20).slice(-1));
    await renderBoth();
    expect(todayLine()).toBe("오늘 7장 · 약 4분이면 끝나요");
  });

  it("reads the day's new cards as the day stood when it started, so answering its reviews leaves them", async () => {
    postgrest.seed("decks", deckRow("d-fr", "French"));
    const reviews = ["un", "deux", "trois", "quatre"];
    postgrest.seed(
      "cards",
      ...reviews.map((front) => cardRow(`due-${front}`, "d-fr", front)),
      ...Array.from({ length: 10 }, (_, index) =>
        cardRow(`new-${String(index)}`, "d-fr", `new ${String(index)}`),
      ),
    );
    postgrest.seed("card_states", ...reviews.map((front) => stateRow(`due-${front}`, due)));
    // 5 minutes: (300 s - 4 reviews at 25 s) / 25 s is 8 new cards, short of the deck's ten.
    postgrest.studySettings.set(testUser.id, {
      daily_minutes: 5,
      updated_at: new Date(start).toISOString(),
    });
    // Five study days before today of four cards each answered twice in 25 s, and each due
    // card's last answer.
    postgrest.seed(
      "reviews",
      ...[1, 2, 3, 4, 5].flatMap((days) =>
        [0, 1, 2, 3].flatMap((card) => [
          reviewRow(
            `h-${String(days)}-${String(card)}`,
            `h-${String(days)}-${String(card)}`,
            start - days * day,
            25_000,
          ),
          reviewRow(
            `h-${String(days)}-${String(card)}-r`,
            `h-${String(days)}-${String(card)}`,
            start - days * day + 60_000,
            25_000,
          ),
        ]),
      ),
      ...reviews.map((front) => reviewRow(`last-${front}`, `due-${front}`, due.lastReview, 6_000)),
    );
    await renderBoth();
    // The four reviews due and the day's new cards; the line goes on with the minutes, which the
    // paces set.
    const before = cardsLeft() - 4;
    // The figure is the user's own, short of the ten new cards the deck holds.
    expect(before).toBeGreaterThan(0);
    expect(before).toBeLessThan(10);
    cleanup();

    // Each review answered an hour ago, and now due in nine days.
    postgrest.seed(
      "reviews",
      ...reviews.map((front) =>
        reviewRow(`today-${front}`, `due-${front}`, start - 3_600_000, 6_000),
      ),
    );
    postgrest.rows.card_states = reviews.map((front) =>
      postgrest.rows.card_states.find((row) => row.card_id === `due-${front}`)
        ? { ...stateRow(`due-${front}`, notDue), revision: 0 }
        : {},
    );
    await renderBoth();

    // The reviews are done; the new cards stand as the day started.
    expect(cardsLeft()).toBe(before);
  });

  it("says a card is unreadable when an earlier answer to a card answered today names it by no string", async () => {
    const unreadable =
      "이 앱이 읽을 수 없는 카드가 있어 불러오지 못했어요. 휴대폰 앱에서 카드를 확인해 주세요.";
    postgrest.seed("decks", deckRow("d-fr", "French"));
    postgrest.seed("cards", cardRow("fr", "d-fr", "chat"));
    postgrest.seed("reviews", reviewRow("today", "fr", start - 3_600_000, 6_000));
    // Control: an earlier answer naming the card by its id is read.
    postgrest.seed("reviews", reviewRow("before", "fr", start - 2 * day, 6_000));
    await render(Today, {});
    expect(cardsLeft()).toBe(1);
    expect(screen.queryByText(unreadable)).not.toBeInTheDocument();
    cleanup();

    // The same answer with its card id held as a list, which the card filter still matches.
    postgrest.rows.reviews = postgrest.rows.reviews.map((row) =>
      row.id === "before" ? { ...row, card_id: [uuidOf("fr")] } : row,
    );
    await render(Today, {});

    const reason = screen.getByText(unreadable);
    // On the ground under the sky, in the streak's place over 시작, so it is on the one screen.
    const hero = screen.getByRole("region", { name: "오늘 할 카드" });
    expect(hero.compareDocumentPosition(reason) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      reason.compareDocumentPosition(screen.getByRole("link", { name: "시작" })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("marks a deck its owner published with 공개, and no other", async () => {
    postgrest.seed("decks", deckRow("d-fr", "French", false, "public"), deckRow("d-es", "Spanish"));
    postgrest.seed("cards", cardRow("fr", "d-fr", "chat"), cardRow("es", "d-es", "gato"));

    await renderBoth();

    expect(rowNames()).toEqual(["French, 카드 1장, 공개, 오늘 1", "Spanish, 카드 1장, 오늘 1"]);
    // 공개 in the one chip's neutral tone (ADR 0119), and today's count in the accent beside it.
    expect(chipTone(within(row("French")).getByText("공개"))).toBe("surface");
    expect(within(row("French")).getByText("1")).toHaveClass("text-accent");
    // Control: the private deck's row carries no chip.
    expect(within(row("Spanish")).queryByText("공개")).not.toBeInTheDocument();
  });

  it("shows each request only its own user's decks, cards, states and pace", async () => {
    postgrest.seed("decks", deckRow("d-fr", "French"), {
      ...deckRow("d-other", "Other"),
      user_id: otherUser.id,
    });
    const fronts = ["un", "deux", "trois"];
    postgrest.seed(
      "cards",
      ...fronts.map((front) => cardRow(`fr-${front}`, "d-fr", front)),
      ...fronts.map((front) => ({
        ...cardRow(`other-${front}`, "d-other", front),
        user_id: otherUser.id,
      })),
    );
    postgrest.seed(
      "card_states",
      ...fronts.map((front) => stateRow(`fr-${front}`, due)),
      ...fronts.map((front) => ({ ...stateRow(`other-${front}`, due), user_id: otherUser.id })),
    );
    // The other user's 40 answers of 25 s yesterday: one first answer and 39 reviews.
    postgrest.seed(
      "reviews",
      ...Array.from({ length: 40 }, (_, index) => ({
        ...reviewRow(`r-other-${String(index)}`, "other-un", start - day + index, 25_000),
        user_id: otherUser.id,
      })),
    );

    // Three reviews at the unknown pace, 10 s each.
    await renderBoth();
    expect(rowNames()).toEqual(["French, 카드 3장, 오늘 3"]);
    expect(todayLine()).toBe("오늘 3장 · 약 1분이면 끝나요");
    cleanup();

    // The other user's next request reads theirs, and nothing of the first user's: 3 at 25 s.
    setRequestCookies(await signedInCookies(otherUser));
    await renderBoth();
    expect(rowNames()).toEqual(["Other, 카드 3장, 오늘 3"]);
    expect(todayLine()).toBe("오늘 3장 · 약 2분이면 끝나요");
  });

  it("carries no account content: neither the email nor 로그아웃", async () => {
    postgrest.seed("decks", deckRow("d-fr", "French"));

    await renderBoth();

    // Control: the deck list itself rendered.
    expect(screen.getByRole("heading", { level: 1, name: "노트" })).toBeInTheDocument();
    expect(screen.queryByText(testUser.email, { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "로그아웃" })).not.toBeInTheDocument();
  });

  it("reads every page of a library larger than one PostgREST answer", async () => {
    postgrest.seed("decks", deckRow("d-big", "Big"));
    postgrest.seed(
      "cards",
      ...Array.from({ length: 1001 }, (_, index) =>
        cardRow(`c-${String(index)}`, "d-big", `w${String(index)}`),
      ),
    );

    await renderNotes();

    // New cards are capped at the day's: 20 minutes at 10 s a card, with no answer stored.
    expect(rowNames()).toEqual(["Big, 카드 1001장, 오늘 120"]);
    expect(postgrest.requests.filter((request) => request === "GET cards")).toHaveLength(2);
  });

  it("reads a library of exactly two pages with one request per page, the first counting them", async () => {
    postgrest.seed("decks", deckRow("d-big", "Big"));
    postgrest.seed(
      "cards",
      ...Array.from({ length: 2000 }, (_, index) =>
        cardRow(`c-${String(index)}`, "d-big", `w${String(index)}`),
      ),
    );

    await renderNotes();

    // Control: every card is read.
    expect(rowNames()).toEqual(["Big, 카드 2000장, 오늘 120"]);
    expect(postgrest.requests.filter((request) => request === "GET cards")).toHaveLength(2);
  });

  it("filters the notes by name from the 노트 검색 field over them, and says so in the app's words when nothing matches", async () => {
    postgrest.seed("decks", deckRow("d-fr", "French"), deckRow("d-es", "Spanish"));
    await renderNotes();
    const user = userEvent.setup();

    const search = screen.getByRole("searchbox", { name: "노트 검색" });
    expect(rowNames()).toEqual(["French, 카드 0장", "Spanish, 카드 0장"]);
    await user.type(search, "fre");
    expect(rowNames()).toEqual(["French, 카드 0장"]);

    await user.clear(search);
    await user.type(search, "zèbre");
    expect(screen.getByRole("status")).toHaveTextContent(
      "찾는 노트가 없어요. 다른 단어로 검색해 보세요.",
    );
    cleanup();

    // Control: with no note, there is nothing to search.
    postgrest = new FakePostgrest();
    server.use(...postgrest.handlers);
    await renderNotes();
    expect(screen.queryByRole("searchbox", { name: "노트 검색" })).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("heads the 노트 page with ⋯ 노트 메뉴 on a raised surface beside its title, which holds no primary fill", async () => {
    postgrest.seed("decks", deckRow("d-fr", "French"));
    await renderNotes();

    const header = screen.getByRole("heading", { level: 1, name: "노트" }).closest("header");
    const menu = screen.getByRole("button", { name: "노트 메뉴" });
    expect(menu.closest("header")).toBe(header);
    expect(menu).toHaveClass("rounded-chip", "bg-surface", "size-tap-target");
    expect(menu.querySelector("svg")).not.toBeNull();
    // Making a note by hand is its one item, where 새 노트 was a button (#722).
    expect(screen.queryByRole("button", { name: "새 노트" })).not.toBeInTheDocument();
    expect(document.querySelector(".bg-primary")).toBeNull();
    // Control: the selector finds a primary fill where the page draws one, 홈's first run.
    cleanup();
    postgrest = new FakePostgrest();
    server.use(...postgrest.handlers);
    await render(Today, {});
    expect(document.querySelector(".bg-primary")).not.toBeNull();
  });

  it("reads no card's sides, which the deck list does not show", async () => {
    postgrest.seed("decks", deckRow("d-fr", "French"));
    postgrest.seed("cards", cardRow("fr", "d-fr", "chat"));

    await renderNotes();

    // Control: the card is read and counted.
    expect(rowNames()).toEqual(["French, 카드 1장, 오늘 1"]);
    expect(postgrest.selected.filter((read) => read.startsWith("cards: "))).toEqual([
      "cards: id,deck_id,created_at",
    ]);
  });

  it("says the server cannot be reached when PostgREST does not answer, under the page's heading", async () => {
    postgrest.fail("decks", 500);

    await render(Today, {});

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("서버에 연결할 수 없어요. 연결을 확인하고 다시 시도해 주세요.");
    const heading = screen.getByRole("heading", { level: 1, name: "알아몰라" });
    expect(heading.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    cleanup();

    // With nothing read, the heading stands alone above the failure.
    server.use(supabaseUnreachable);
    await render(Today, {});
    expect(screen.getByRole("heading", { level: 1, name: "알아몰라" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("서버에 연결할 수 없어요.");
  });

  it("puts a day that cannot be counted under the hero, in the week card's place, and over the notes on the 노트 page, and keeps 시작 on the hero", async () => {
    postgrest.seed("decks", deckRow("d-fr", "French"));
    postgrest.seed("cards", cardRow("fr", "d-fr", "chat"));
    // Control: with the day read, neither page holds a notice, and 홈 holds the week card.
    await renderBoth();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "0일 연속" })).toBeInTheDocument();
    cleanup();

    postgrest.fail("reviews", 500);
    await render(Today, {});
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("서버에 연결할 수 없어요.");
    const hero = screen.getByRole("region", { name: "오늘 할 카드" });
    expect(hero.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("region", { name: /일 연속$/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "시작" })).toHaveAttribute(
      "href",
      `/study?decks=${uuidOf("d-fr")}`,
    );
    cleanup();

    await renderNotes();
    const notice = within(screen.getByRole("region", { name: "노트 목록" })).getByRole("alert");
    // Above the rows, which keep the note's card count without the progress the day would give.
    const french = row("French");
    expect(notice.compareDocumentPosition(french) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(french).toHaveAccessibleName("French, 카드 1장");
  });

  it("with no card left today says the cards are done and links 학습하기 to the study page over every deck, which opens on nothing to study or on the completion sheet", async () => {
    postgrest.seed("decks", deckRow("d-fr", "French"), deckRow("d-es", "Spanish"));
    postgrest.seed("cards", cardRow("fr-later", "d-fr", "oiseau"));
    postgrest.seed("card_states", stateRow("fr-later", notDue));
    // Answered yesterday: nothing was answered today.
    postgrest.seed("reviews", reviewRow("r-yesterday", "fr-later", start - day, 1_000));

    for (const answered of ["yesterday", "today"]) {
      if (answered === "today") {
        postgrest.seed("reviews", reviewRow("r-today", "fr-later", start - 3_600_000, 1_000));
      }
      await render(Today, {});

      expect(screen.getByRole("heading", { name: "오늘 다 했어요" }), answered).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "시작" }), answered).not.toBeInTheDocument();
      const href = screen.getByRole("link", { name: "학습하기" }).getAttribute("href");
      expect(href, answered).toBe(`/study?decks=${uuidOf("d-fr")},${uuidOf("d-es")}`);

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
      cleanup();
    }
  });

  it("with nothing left and nothing answered today says the day is done in the sky with the next review in its three forms, and once a card is answered today the cards done, with 학습하기 secondary on the ground under the sleepy mascot", async () => {
    const hero = () => screen.getByRole("region", { name: "오늘 다 했어요" });
    // Thursday 15 January 2026 in Seoul. Each card was last answered yesterday and is due later.
    for (const [dueIn, line] of [
      [1, "다음 복습은 내일 · 1장, 약 1분"],
      [3, "다음 복습은 일요일 · 1장, 약 1분"],
      [9, "앞으로 7일 동안 복습할 카드가 없어요"],
    ] as const) {
      postgrest = new FakePostgrest();
      server.use(...postgrest.handlers);
      postgrest.seed("decks", deckRow("d-fr", "French"));
      postgrest.seed("cards", cardRow("fr", "d-fr", "oiseau"));
      postgrest.seed(
        "card_states",
        stateRow("fr", {
          stability: 3,
          difficulty: 5,
          lastReview: start - day,
          due: start + dueIn * day,
        }),
      );
      postgrest.seed("reviews", reviewRow("r-fr", "fr", start - day, 6_000));
      await render(Today, {});

      expect(within(hero()).getByText(line), line).toBeInTheDocument();
      cleanup();
    }
    // Answered an hour ago: today's one card done, in place of the next review.
    postgrest.seed("reviews", reviewRow("r-today", "fr", start - 3_600_000, 6_000));
    await render(Today, {});

    expect(hero()).toHaveClass("bg-hero");
    expect(within(hero()).getByText("1장")).toBeInTheDocument();
    expect(within(hero()).queryByText(/다음 복습|복습할 카드가 없어요/)).not.toBeInTheDocument();
    expect(hero().querySelector('img[src*="knowno-sleepy"]')).not.toBeNull();
    const study = screen.getByRole("link", { name: "학습하기" });
    expect(study).toHaveClass("bg-surface");
    expect(study).toHaveAttribute("aria-keyshortcuts", "Enter");
    expect(hero()).not.toContainElement(study);
    // The streak on the ground, yesterday and today, today's dot filled once the day is done.
    const week = screen.getByRole("region", { name: "2일 연속" });
    expect(hero().compareDocumentPosition(week) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const today = week.querySelectorAll("[data-day]")[6];
    expect(today).toHaveAttribute("data-day", "today-done");
    expect(today).toHaveClass("bg-today-mark");
  });

  it("draws on the ground the streak: its count in the accent over a dot a day for the last seven days, a studied day filled in the accent, a day without one outlined, and today outlined in the today mark over its label; and the streak leaves the sky", async () => {
    postgrest.seed("decks", deckRow("d-fr", "French"));
    postgrest.seed(
      "cards",
      ...["a", "b"].map((front) => cardRow(`new-${front}`, "d-fr", front)),
      cardRow("done-e", "d-fr", "e"),
      cardRow("done-f", "d-fr", "f"),
    );
    postgrest.seed("card_states", stateRow("done-e", notDue), stateRow("done-f", notDue));
    // Yesterday two cards, and today one: a streak of two days, with two cards left today.
    postgrest.seed(
      "reviews",
      reviewRow("r-e1", "done-e", start - day, 6_000),
      reviewRow("r-f1", "done-f", start - day, 6_000),
      reviewRow("r-e2", "done-e", start - 3_600_000, 6_000),
    );
    await render(Today, {});

    const hero = screen.getByRole("region", { name: "오늘 2장" });
    expect(within(hero).queryByText(/일 연속/)).not.toBeInTheDocument();
    const week = screen.getByRole("region", { name: "2일 연속" });
    expect(hero.compareDocumentPosition(week) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      within(within(week).getByRole("heading", { name: "2일 연속" })).getByText("2"),
    ).toHaveClass("text-accent");
    // The bar chart and its total have left 홈.
    expect(within(week).queryByText(/지난 7일/)).not.toBeInTheDocument();
    const dots = within(week).getByRole("img");
    expect(dots).toHaveAccessibleName(
      /^\S+ 0장, \S+ 0장, \S+ 0장, \S+ 0장, \S+ 0장, \S+ 2장, 오늘 1장$/,
    );
    const days = [...dots.querySelectorAll("[data-day]")];
    expect(days.map((dot) => dot.getAttribute("data-day"))).toEqual([
      ...Array<string>(5).fill("none"),
      "studied",
      "today",
    ]);
    expect(days.at(0)).toHaveClass("border-outline");
    expect(days.at(-2)).toHaveClass("bg-accent");
    expect(days.at(-1)).toHaveClass("border-today-mark");
    expect(days.at(-1)).not.toHaveClass("bg-today-mark");
    expect(within(week).getByText("오늘").closest(".text-today-text")).not.toBeNull();
    expect(todayLine()).toBe("오늘 2장 · 약 1분이면 끝나요");
    cleanup();

    // Control: with no study day, no day is filled, on no streak.
    postgrest.rows.reviews = [];
    await render(Today, {});
    const empty = screen.getByRole("region", { name: "0일 연속" });
    expect(
      [...empty.querySelectorAll("[data-day]")].map((dot) => dot.getAttribute("data-day")),
    ).toEqual([...Array<string>(6).fill("none"), "today"]);
  });

  it("agrees with the study page on the day's cards: a card answered 모른다 today is left, one answered 안다 done", async () => {
    postgrest.seed("decks", deckRow("d-fr", "French"));
    postgrest.seed("cards", cardRow("a", "d-fr", "a"), cardRow("b", "d-fr", "b"));
    // Both were due; this morning a was answered 안다 and b 모른다, each now due tomorrow.
    const tomorrow = {
      stability: 1,
      difficulty: 5,
      lastReview: start - 3_600_000,
      due: start + day,
    };
    postgrest.seed("card_states", stateRow("a", tomorrow), stateRow("b", tomorrow));
    postgrest.seed("reviews", reviewRow("r-a", "a", start - 3_600_000, 6_000), {
      ...reviewRow("r-b", "b", start - 3_600_000, 6_000),
      rating: "again",
    });
    await render(Today, {});

    expect(cardsLeft()).toBe(1);
    cleanup();

    await render(Study, { searchParams: Promise.resolve({ decks: uuidOf("d-fr") }) });
    await waitFor(() => {
      expect(screen.queryByText("카드를 불러오는 중이에요.")).not.toBeInTheDocument();
    });
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "앞면" })).toHaveTextContent("b");
  });

  it("opens 모두 학습 on Enter from the page, but not from a control", async () => {
    postgrest.seed("decks", deckRow("d-fr", "French"));
    postgrest.seed("cards", cardRow("fr-new", "d-fr", "chat"));
    await renderBoth();
    const study = screen.getByRole("link", { name: "시작" });
    const clicked = vi.spyOn(study, "click").mockImplementation(() => undefined);
    const user = userEvent.setup();

    expect(study).toHaveAttribute("aria-keyshortcuts", "Enter");
    // Control: Enter on another link is that link's own.
    row("French").focus();
    await user.keyboard("{Enter}");
    expect(clicked).not.toHaveBeenCalled();
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard("{Enter}");
    expect(clicked).toHaveBeenCalledOnce();
  });

  it("shows the first-run invitation in the sky, with no streak, when there is no note, under the profile button", async () => {
    const title = "첫 노트를 만들어 볼까요?";
    // Control: a user with one note sees the hero and the notes, and no invitation.
    postgrest.seed("decks", deckRow("d-fr", "French"));
    postgrest.seed("cards", cardRow("c-chat", "d-fr", "chat"));
    postgrest.seed("card_states", stateRow("c-chat", notDue));
    await renderBoth();
    expect(screen.getByRole("heading", { level: 1, name: "노트" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: title })).not.toBeInTheDocument();
    cleanup();

    postgrest = new FakePostgrest();
    server.use(...postgrest.handlers);
    await render(Today, {});

    expect(screen.getByRole("heading", { level: 1, name: "알아몰라" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: title })).toHaveClass("text-title");
    const sky = screen.getByRole("region", { name: title });
    expect(sky).toHaveClass("bg-hero");
    expect(sky.querySelector('img[src*="knowno-thinking"]')).not.toBeNull();
    expect(screen.queryByRole("region", { name: /일 연속$/ })).not.toBeInTheDocument();
    // The links are the profile button, which opens 설정, the mascot and the one action, both
    // 말랑이's chat (#722).
    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/account",
      "/assistant",
      "/assistant",
    ]);
    // The first note is made with 말랑이, the page's one way on, in the primary fill.
    expect(screen.getByRole("link", { name: "말랑이와 첫 노트 만들기" })).toHaveClass("bg-primary");
    expect(screen.queryByRole("button", { name: "새 노트 만들기" })).not.toBeInTheDocument();
  });

  it("makes the mascot 말랑이's entry, its bubble saying how many cards it has ready while a proposal waits", async () => {
    postgrest.seed("decks", deckRow("d-fr", "French"));
    postgrest.seed("cards", cardRow("c-chat", "d-fr", "chat"));
    postgrest.seed("card_states", stateRow("c-chat", due));
    await render(Today, {});
    // Nothing by default: the link is named for the chat alone.
    expect(screen.getByRole("link", { name: "말랑이와 대화하기" })).toHaveAttribute(
      "href",
      "/assistant",
    );
    cleanup();

    const cards = Array.from({ length: 12 }, (_, index) => ({
      id: `c${String(index)}`,
      card: { front: String(index), back: "뜻" },
    }));
    const store = (added: object | null) => {
      window.localStorage.setItem(
        "knowno.assistant",
        JSON.stringify({
          version: 1,
          draft: "",
          turns: [
            {
              role: "assistant",
              id: "a1",
              text: "",
              citations: [],
              choice: null,
              ending: "ok",
              proposals: [
                {
                  proposal: {
                    id: "p1",
                    kind: "cards",
                    deck: { id: null, name: "영단어" },
                    groups: [{ id: "g1", title: "1단원", format: "text", cards }],
                  },
                  checked: { g1: cards.map((card) => card.id) },
                  added,
                },
              ],
            },
          ],
        }),
      );
    };
    store(null);
    await render(Today, {});
    // A substring: the link reads its own name, then the bubble's words.
    expect(
      screen.getByRole("link", { name: /^말랑이와 대화하기.*카드 12장 만들어 뒀어요$/ }),
    ).toBeInTheDocument();
    cleanup();

    // Control: once added, nothing is ready.
    store({ deck: { id: "d1", name: "영단어" }, count: 12 });
    await render(Today, {});
    expect(screen.getByRole("link", { name: "말랑이와 대화하기" })).toBeInTheDocument();
    window.localStorage.clear();
  });

  it("shows how to start in the sky when the notes hold no card, leading to the one note's 카드 추가 or to the notes", async () => {
    const title = "첫 카드를 만들어 볼까요?";
    postgrest.seed("decks", deckRow("d-fr", "French"));
    await render(Today, {});

    const hero = screen.getByRole("region", { name: title });
    expect(hero).toHaveClass("bg-hero");
    // No streak: the one way on is the page's.
    expect(screen.queryByRole("region", { name: /일 연속$/ })).not.toBeInTheDocument();
    // The thinking mascot, the mark itself, while nothing is done yet (ADR 0193).
    expect(hero.querySelector('img[src*="knowno-thinking"]')).not.toBeNull();
    // Its one action, the primary on the ground, opens the one note with its 카드 추가 sheet up.
    const add = screen.getByRole("link", { name: "카드 추가" });
    expect(add).toHaveClass("bg-primary");
    expect(add).toHaveAttribute("href", `/decks/${uuidOf("d-fr")}?adding=1`);
    cleanup();

    // With several notes, it leads to the 노트 page instead.
    postgrest.seed("decks", deckRow("d-de", "German"));
    await render(Today, {});
    expect(screen.getByRole("link", { name: "노트에서 카드 추가" })).toHaveAttribute(
      "href",
      "/decks",
    );
    cleanup();

    // Control: with a card in a note, the day shows.
    postgrest.seed("cards", cardRow("c-chat", "d-fr", "chat"));
    await render(Today, {});
    expect(screen.queryByRole("heading", { name: title })).not.toBeInTheDocument();
  });

  it("draws 홈 and the 노트 page in three sizes, the title, the body and the caption, in every state", async () => {
    const overdue = {
      stability: 30,
      difficulty: 5,
      lastReview: start - 31 * day,
      due: start - day,
    };
    const states: [string, () => void][] = [
      ["첫 노트를 만들어 볼까요?", () => undefined],
      [
        "첫 카드를 만들어 볼까요?",
        () => {
          postgrest.seed("decks", deckRow("d-fr", "French"));
        },
      ],
      [
        "오늘 1장",
        () => {
          postgrest.seed("decks", deckRow("d-fr", "French"));
          postgrest.seed("cards", cardRow("c-chat", "d-fr", "chat"));
        },
      ],
      [
        "오늘 다 했어요",
        () => {
          postgrest.seed("decks", deckRow("d-fr", "French"));
          postgrest.seed("cards", cardRow("c-chat", "d-fr", "chat"));
          postgrest.seed("card_states", stateRow("c-chat", notDue));
        },
      ],
      [
        "다시 시작하면 돼요",
        () => {
          postgrest.seed("decks", deckRow("d-fr", "French"));
          postgrest.seed(
            "cards",
            ...["a", "b", "c"].map((name) => cardRow(`c-${name}`, "d-fr", name)),
          );
          postgrest.seed(
            "card_states",
            ...["a", "b", "c"].map((name) => stateRow(`c-${name}`, overdue)),
          );
        },
      ],
    ];
    for (const [state, seed] of states) {
      postgrest = new FakePostgrest();
      server.use(...postgrest.handlers);
      seed();
      await render(Today, {});
      // The state the seed asked for.
      expect(screen.getByRole("heading", { name: state })).toBeInTheDocument();
      expect({ state, sizes: typeSizesOf(document.body) }).toEqual({
        state,
        // Before a first card, 홈 is its title, its sentence, the profile's initial and one
        // action, and no week card: it draws no caption.
        sizes: state.startsWith("첫 ") ? [16, 26] : [13, 16, 26],
      });
      cleanup();
      await renderNotes();
      expect({ state, notes: typeSizesOf(document.body) }).toEqual({
        state,
        // With no note, the title alone: ⋯ and 말랑이 at the edge draw no words, and the
        // one-time hint waits for a first note.
        notes: state === "첫 노트를 만들어 볼까요?" ? [28] : [13, 16, 28],
      });
      cleanup();
    }
  });

  describe("study past the day's plan", () => {
    const names = Array.from({ length: 45 }, (_, index) => `c${String(index).padStart(2, "0")}`);
    /**
     * One deck of [names], 5 minutes a day (30 new cards at 10 s), and today's first answers to
     * the first [answered]: those at [dontKnow] positions answered "모른다", due again within the
     * day, the others "안다", due tomorrow.
     */
    const seedDay = (answered: number, dontKnow: (index: number) => boolean) => {
      postgrest.seed("decks", deckRow("d-fr", "French"));
      postgrest.seed("cards", ...names.map((name) => cardRow(name, "d-fr", name)));
      postgrest.studySettings.set(testUser.id, {
        daily_minutes: 5,
        updated_at: new Date(start).toISOString(),
      });
      const first = names.slice(0, answered);
      postgrest.seed(
        "reviews",
        ...first.map((name, index) => ({
          ...reviewRow(`r-${name}`, name, start - 2 * 3_600_000 + index * 60_000, 6_000),
          rating: dontKnow(index) ? "again" : "good",
        })),
      );
      postgrest.seed(
        "card_states",
        ...first.map((name, index) =>
          stateRow(name, {
            stability: 1,
            difficulty: 5,
            lastReview: start - 3_600_000,
            due: dontKnow(index) ? start + 600_000 : start + day,
          }),
        ),
      );
    };

    it("keeps the day done after ten cards past it, five answered 모른다: the goal stays the plan and the ten count apart", async () => {
      seedDay(40, (index) => index >= 30 && index % 2 === 0);
      await render(Today, {});

      // The cards past the plan never reopen the day: the hero holds no count left.
      expect(screen.getByRole("heading", { name: "오늘 다 했어요" })).toBeInTheDocument();
      expect(document.getElementById("hero-time")).toBeNull();
    });

    it("control: before the day is done, a planned card answered 모른다 stays left", async () => {
      seedDay(30, (index) => index === 0);
      await render(Today, {});

      expect(cardsLeft()).toBe(1);
      expect(screen.queryByText(/더 했어요$/)).not.toBeInTheDocument();
    });
  });
});
