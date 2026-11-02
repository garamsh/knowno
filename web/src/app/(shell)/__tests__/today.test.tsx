import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEngine, timeZoneCookie } from "@/features/study";

import { FakePostgrest } from "@/testing/mocks/postgrest";
import { otherUser, supabaseUnreachable, testUser } from "@/testing/mocks/handlers";
import { server } from "@/testing/mocks/server";
import { cardRow, day, deckRow, reviewRow, start, stateRow, uuidOf } from "@/testing/library";
import { setRequestCookies } from "@/testing/next-headers";
import { render } from "@/testing/render";
import { chipTone } from "@/testing/chip";
import { expectTextReadable } from "@/testing/contrast";
import { signedInCookies } from "@/testing/session";
import { typeSizesOf } from "@/testing/type-sizes";

import { Study } from "../../study/_components/study";
import { Today } from "../_components/today";
import { Decks } from "../decks/_components/decks";

/** The 오늘 page's content and the 덱 page's, rendered one after the other. */
const renderBoth = () =>
  render(
    async () => (
      <>
        {await Today()}
        {await Decks()}
      </>
    ),
    {},
  );

// The study screen starts its session once the browser's engine has loaded; its first load
// compiles the module.
beforeAll(async () => {
  await loadEngine();
}, 30_000);

vi.mock("next/headers", () => import("@/testing/next-headers"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const due = { stability: 3, difficulty: 5, lastReview: start - 4 * day, due: start - day };
const notDue = { stability: 30, difficulty: 5, lastReview: start - day, due: start + 9 * day };

describe("the 오늘 and 덱 pages", () => {
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
  const deckList = () => within(screen.getByRole("region", { name: "덱 목록" }));
  const row = (name: string) =>
    deckList().getByRole("link", { name: new RegExp(`^${name}, 카드`) });
  /**
   * The today card's done count over the day's cards and its minutes, as drawn: "d / n장 · 약 m분",
   * the minutes ending "남음" once a card is done.
   */
  const todayLine = () =>
    `${document.getElementById("today-count")?.textContent ?? ""} · ${
      document.getElementById("today-time")?.textContent ?? ""
    }`;
  /** The cards left on the today card: the day's cards less those done. */
  const cardsLeft = () => {
    const [, done, goal] = /^(\d+) \/ (\d+)장/.exec(todayLine()) ?? [];
    return Number(goal) - Number(done);
  };
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

    expect(screen.getByRole("heading", { name: "오늘 할 카드" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "2장 중 0장" })).toBeInTheDocument();
    expect(todayLine()).toBe("0 / 2장 · 약 1분");
    expect(screen.getByRole("link", { name: "모두 학습" })).toHaveAttribute(
      "href",
      `/study?decks=${uuidOf("d-fr")},${uuidOf("d-es")}`,
    );
    expect(screen.getByRole("heading", { name: "내 덱 2" })).toBeInTheDocument();
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
    expect(todayLine()).toBe("0 / 2장 · 약 1분");
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

    const backlog = screen.getByRole("region", { name: title });
    const card = within(backlog);
    // White with ink accents, as the phone's (ADR 0098).
    expect(backlog).toHaveClass("bg-surface", "shadow-card");
    expect(card.getByRole("link", { name: "모두 학습" })).toHaveClass(
      "bg-primary",
      "text-on-primary",
    );
    expectTextReadable(backlog);
    // The mascot with no badge: the card's one icon is play, on its button (ADR 0116).
    expect(backlog.querySelector('img[src*="knowno-thinking"]')).not.toBeNull();
    expect([...backlog.querySelectorAll("svg")].map((icon) => icon.closest("a") !== null)).toEqual([
      true,
    ]);
    // The minutes are set in 설정 alone.
    expect(card.queryByRole("button", { name: /하루 학습 시간/ })).not.toBeInTheDocument();
    expect(
      card.getByText("밀린 복습 3장을 급한 것부터 해요. 새 카드는 잠시 쉬어요."),
    ).toBeInTheDocument();
    expect(card.getByRole("link", { name: "모두 학습" })).toHaveAttribute(
      "href",
      `/study?decks=${uuidOf("d-fr")}`,
    );
    expect(screen.queryByRole("heading", { name: /^오늘 할 카드/ })).not.toBeInTheDocument();
    // The load rounds up to one a day: three days to catch up, Thursday 15 January in Seoul.
    const catchUp = within(
      screen.getByRole("region", { name: "하루 1장씩 하면 3일이면 따라잡아요" }),
    );
    expect(
      catchUp.getByRole("img", {
        name: "밀린 복습 예상: 오늘 3장, 내일 2장, 토 1장, 일 0장, 월 0장, 화 0장, 수 0장",
      }),
    ).toBeInTheDocument();
    expect(catchUp.queryByText("하루 1장씩 했을 때 남는 밀린 복습이에요")).not.toBeInTheDocument();
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
    expect(screen.getByRole("heading", { name: "내 덱 1" })).toBeInTheDocument();
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
    expect(todayLine()).toBe("0 / 7장 · 약 3분");
    cleanup();

    // The twentieth review: 3 at 24 s and 4 at 30 s.
    postgrest.seed("reviews", ...history(20).slice(-1));
    await renderBoth();
    expect(todayLine()).toBe("0 / 7장 · 약 4분");
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

    expect(screen.getByText(unreadable)).toBeInTheDocument();
  });

  it("marks a deck its owner published with 공개, and no other", async () => {
    postgrest.seed("decks", deckRow("d-fr", "French", false, "public"), deckRow("d-es", "Spanish"));
    postgrest.seed("cards", cardRow("fr", "d-fr", "chat"), cardRow("es", "d-es", "gato"));

    await renderBoth();

    expect(rowNames()).toEqual(["French, 카드 1장, 공개, 오늘 1", "Spanish, 카드 1장, 오늘 1"]);
    // Both in the one chip, 공개 in its neutral tone and today's count in the brand's (ADR 0119).
    expect(chipTone(within(row("French")).getByText("공개"))).toBe("surface");
    expect(chipTone(within(row("French")).getByText("오늘 1"))).toBe("brand-tint");
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
    expect(todayLine()).toBe("0 / 3장 · 약 1분");
    cleanup();

    // The other user's next request reads theirs, and nothing of the first user's: 3 at 25 s.
    setRequestCookies(await signedInCookies(otherUser));
    await renderBoth();
    expect(rowNames()).toEqual(["Other, 카드 3장, 오늘 3"]);
    expect(todayLine()).toBe("0 / 3장 · 약 2분");
  });

  it("carries no account content: neither the email nor 로그아웃", async () => {
    postgrest.seed("decks", deckRow("d-fr", "French"));

    await renderBoth();

    // Control: the deck list itself rendered.
    expect(screen.getByRole("heading", { name: "내 덱 1" })).toBeInTheDocument();
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

    await render(Decks, {});

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

    await render(Decks, {});

    // Control: every card is read.
    expect(rowNames()).toEqual(["Big, 카드 2000장, 오늘 120"]);
    expect(postgrest.requests.filter((request) => request === "GET cards")).toHaveLength(2);
  });

  it("filters the deck list by name, and says so in the app's words when nothing matches", async () => {
    postgrest.seed("decks", deckRow("d-fr", "French"), deckRow("d-es", "Spanish"));
    await render(Decks, {});
    const user = userEvent.setup();

    await user.type(screen.getByRole("searchbox", { name: "덱 검색" }), "fre");
    expect(rowNames()).toEqual(["French, 카드 0장"]);

    await user.clear(screen.getByRole("searchbox", { name: "덱 검색" }));
    await user.type(screen.getByRole("searchbox", { name: "덱 검색" }), "zèbre");
    expect(screen.getByRole("status")).toHaveTextContent(
      "찾는 덱이 없어요. 다른 단어로 검색해 보세요.",
    );
  });

  it("reads no card's sides, which the deck list does not show", async () => {
    postgrest.seed("decks", deckRow("d-fr", "French"));
    postgrest.seed("cards", cardRow("fr", "d-fr", "chat"));

    await render(Decks, {});

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
    // The day was read, so its date stays beside the heading.
    const heading = screen.getByRole("heading", { level: 1, name: "오늘" });
    expect(heading.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("1월 15일 목요일")).toBeInTheDocument();
    cleanup();

    // With nothing read, the heading stands alone above the failure.
    server.use(supabaseUnreachable);
    await render(Today, {});
    expect(screen.getByRole("heading", { level: 1, name: "오늘" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("서버에 연결할 수 없어요.");
    expect(screen.queryByText("1월 15일 목요일")).not.toBeInTheDocument();
  });

  it("with no card left today says the cards are done and links 학습하기 to the study page over every deck, which opens on nothing to study or on the completion card", async () => {
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

      expect(
        screen.getByRole("heading", { name: "오늘 할 카드를 다 했어요" }),
        answered,
      ).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "모두 학습" }), answered).not.toBeInTheDocument();
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
        expect(screen.getByRole("region", { name: "오늘 학습 완료" })).toBeInTheDocument();
      }
      cleanup();
    }
  });

  it("with nothing left draws the phone's done card on the surface: the next review in its three forms, the goal reached and 학습하기 in the coral fill", async () => {
    const card = () => screen.getByRole("region", { name: "오늘 할 카드를 다 했어요" });
    // Thursday 15 January 2026 in Seoul. Each card is answered today, so the goal is reached.
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
          lastReview: start - 3_600_000,
          due: start + dueIn * day,
        }),
      );
      postgrest.seed("reviews", reviewRow("r-fr", "fr", start - 3_600_000, 6_000));
      await render(Today, {});

      expect(within(card()).getByText(line), line).toBeInTheDocument();
      cleanup();
    }
    await render(Today, {});

    expect(card()).toHaveClass("bg-surface");
    expect(card()).not.toHaveClass("bg-brand-tint");
    expect(within(card()).getByText("목표 1장 달성")).toBeInTheDocument();
    expect(within(card()).getAllByText("1일 연속")).toHaveLength(1);
    // The happy mascot with no z's beside it, the goal's chip its words, and the streak's chip
    // its flame, the one icon a chip keeps (ADR 0116, ADR 0141).
    expect(card().querySelector('img[src*="knowno-happy"]')).not.toBeNull();
    expect(card().textContent).not.toMatch(/z/);
    expect(within(card()).getByText("목표 1장 달성").querySelector("svg")).toBeNull();
    expect(within(card()).getByText("1일 연속").querySelector("svg")).not.toBeNull();
    // Both in the one chip, its neutral tone (ADR 0119).
    expect(chipTone(within(card()).getByText("목표 1장 달성"))).toBe("surface");
    expect(chipTone(within(card()).getByText("1일 연속"))).toBe("surface");
    const study = screen.getByRole("link", { name: "학습하기" });
    expect(study).toHaveClass("bg-primary");
    expect(study).toHaveAttribute("aria-keyshortcuts", "Enter");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /하루 학습 시간/ })).not.toBeInTheDocument();
  });

  it("shows the cards done over the day's cards as a count and a bar, the minutes, the streak and where the user stands, from the shared definitions", async () => {
    postgrest.seed("decks", deckRow("d-fr", "French"));
    postgrest.seed(
      "cards",
      ...["a", "b", "c", "d"].map((front) => cardRow(`new-${front}`, "d-fr", front)),
      ...["e", "f"].map((front) => cardRow(`done-${front}`, "d-fr", front)),
    );
    // Two cards first answered an hour ago, due again in nine days: 2 of a goal of 6 done.
    postgrest.seed("card_states", ...["e", "f"].map((front) => stateRow(`done-${front}`, notDue)));
    postgrest.seed(
      "reviews",
      ...["e", "f"].map((front) =>
        reviewRow(`r-${front}`, `done-${front}`, start - 3_600_000, 6_000),
      ),
    );
    await render(Today, {});

    const bar = screen.getByRole("progressbar", { name: "6장 중 2장" });
    expect(bar).toHaveAttribute("aria-valuenow", "2");
    expect(bar).toHaveAttribute("aria-valuemax", "6");
    // The large count, which the bar reads, and the minutes left once a card is done: four new
    // cards at 10 s.
    expect(todayLine()).toBe("2 / 6장 · 약 1분 남음");
    expect(document.getElementById("today-count")).toHaveAttribute("aria-hidden", "true");
    // No goal ring and no minutes control.
    expect(screen.queryByRole("img", { name: /^하루 목표/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /하루 학습 시간/ })).not.toBeInTheDocument();
    // The today card's chip alone; the last seven days' card has no streak line.
    expect(screen.getAllByText("1일 연속")).toHaveLength(1);
    expect(screen.queryByText("좋은 출발이에요")).not.toBeInTheDocument();
    cleanup();

    // Nothing answered today, after two study days in a row: the streak is the line.
    postgrest.rows.reviews = ["e", "f"].map((front, index) =>
      reviewRow(`r-${front}`, `done-${front}`, start - (index + 1) * day, 6_000),
    );
    await render(Today, {});

    expect(screen.getByRole("progressbar", { name: "4장 중 0장" })).toBeInTheDocument();
    // Before any card is done the minutes are the day's, not those left.
    expect(todayLine()).toBe("0 / 4장 · 약 1분");
    expect(screen.getAllByText("2일 연속")).toHaveLength(1);
    expect(screen.queryByText("2일째 이어 가는 중이에요")).not.toBeInTheDocument();
  });

  it("draws the today card white with ink accents and every text outside its button readable on it in both themes", async () => {
    postgrest.seed("decks", deckRow("d-fr", "French"));
    postgrest.seed("cards", cardRow("fr-new", "d-fr", "chat"), cardRow("fr-due", "d-fr", "chien"));
    postgrest.seed("card_states", stateRow("fr-due", due));
    await render(Today, {});

    const card = screen.getByRole("region", { name: "오늘 할 카드" });
    expect(card).toHaveClass("bg-surface", "text-ink", "shadow-card");
    const bar = within(card).getByRole("progressbar");
    expect(bar).toHaveClass("bg-edge");
    expect(bar.firstElementChild).toHaveClass("bg-accent");
    expect(within(card).getByRole("link", { name: "모두 학습" })).toHaveClass(
      "bg-primary",
      "text-on-primary",
    );
    expectTextReadable(card);
    // Control: the same check fails once the quiet status line takes the card's own colour.
    const status = within(card).getByText("오늘 할 카드");
    status.classList.replace("text-muted", "text-surface");
    expect(() => {
      expectTextReadable(card);
    }).toThrow(/오늘 할 카드/);
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

    expect(screen.getByRole("progressbar", { name: "2장 중 1장" })).toBeInTheDocument();
    cleanup();

    await render(Study, { searchParams: Promise.resolve({ decks: uuidOf("d-fr") }) });
    await waitFor(() => {
      expect(screen.queryByText("카드를 불러오는 중이에요.")).not.toBeInTheDocument();
    });
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "앞면" })).toHaveTextContent("b");
  });

  it("shows the last seven study days in the browser's zone, each day's cards once and the week's minutes, linking to 기록", async () => {
    // The same history as app/test/study/overview_test.dart's last seven days, with the same
    // figures: 10:00 on Wednesday 5 November 2025 in Los Angeles, after the change to UTC-8.
    vi.setSystemTime(Date.UTC(2025, 10, 5, 18));
    setRequestCookies([
      ...(await signedInCookies()),
      { name: timeZoneCookie, value: "America/Los_Angeles" },
    ]);
    const fronts = ["a", "b", "c", "d", "e", "f", "g", "h"];
    postgrest.seed("decks", deckRow("d-fr", "French"));
    postgrest.seed("cards", ...fronts.map((front) => cardRow(front, "d-fr", front)));
    const answers: [string, number, number][] = [
      // 29 October, before the seven days.
      ["a", Date.UTC(2025, 9, 29, 15), 10],
      // 30 October: a twice and b, whose 45 s count as 30.
      ["a", Date.UTC(2025, 9, 30, 18), 10],
      ["b", Date.UTC(2025, 9, 30, 18, 5), 45],
      ["a", Date.UTC(2025, 9, 30, 18, 10), 5],
      // 03:59 on 1 November is still 31 October's; 04:00 starts its day.
      ["c", Date.UTC(2025, 10, 1, 10, 59), 20],
      ["d", Date.UTC(2025, 10, 1, 11), 20],
      // 03:30 on 2 November at UTC-8 is still 1 November's; 04:30 is 2 November's.
      ["e", Date.UTC(2025, 10, 2, 11, 30), 10],
      ["f", Date.UTC(2025, 10, 2, 12, 30), 10],
      // 3 November; 4 November has none.
      ["a", Date.UTC(2025, 10, 3, 20), 10],
      ["b", Date.UTC(2025, 10, 3, 20, 1), 10],
      // Today so far, 90 s counting as 30: 185 s in all, 4 minutes, where uncapped would be 5.
      ["g", Date.UTC(2025, 10, 5, 17), 30],
      ["h", Date.UTC(2025, 10, 5, 17, 30), 90],
    ];
    postgrest.seed(
      "reviews",
      ...answers.map(([front, at, seconds], index) =>
        reviewRow(`r${String(index)}`, front, at, seconds * 1000),
      ),
    );
    await render(Today, {});

    const week = screen.getByRole("link", { name: /^지난 7일 동안/ });
    expect(week).toHaveAccessibleName(
      "지난 7일 동안 10장을 4분 학습했어요, 목요일 2장, 금요일 1장, 토요일 2장, 일요일 1장, " +
        "월요일 2장, 화요일 0장, 수요일 2장",
    );
    expect(week).toHaveAccessibleDescription("기록 열기");
    expect(week).toHaveAttribute("href", "/record");
    // Its title and bars alone: no summary line and no streak line.
    expect(within(week).getByText("지난 7일")).toBeInTheDocument();
    expect(within(week).queryByText(/이번 주/)).not.toBeInTheDocument();
    expect(within(week).queryByText(/일 연속/)).not.toBeInTheDocument();
    // The forward forecast is gone.
    expect(screen.queryByText("앞으로 7일")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "오늘" })).toBeInTheDocument();
    expect(screen.getByText("11월 5일 수요일")).toBeInTheDocument();
  });

  it("lists the decks with cards left today, each opening a session over it, and no other", async () => {
    postgrest.seed("decks", deckRow("d-fr", "French"), deckRow("d-es", "Spanish"));
    postgrest.seed(
      "cards",
      cardRow("fr-new", "d-fr", "chat"),
      cardRow("fr-due", "d-fr", "chien"),
      cardRow("es-later", "d-es", "gato"),
    );
    postgrest.seed("card_states", stateRow("fr-due", due), stateRow("es-later", notDue));
    await render(Today, {});

    const decks = within(screen.getByRole("region", { name: "오늘 할 덱" }));
    expect(decks.getAllByRole("link").map((link) => link.getAttribute("aria-label"))).toEqual([
      "French, 오늘 2장 학습",
    ]);
    expect(decks.getByRole("link", { name: "French, 오늘 2장 학습" })).toHaveAttribute(
      "href",
      `/study?decks=${uuidOf("d-fr")}`,
    );
  });

  it("opens 모두 학습 on Enter from the page, but not from a control", async () => {
    postgrest.seed("decks", deckRow("d-fr", "French"));
    postgrest.seed("cards", cardRow("fr-new", "d-fr", "chat"));
    await render(Today, {});
    const study = screen.getByRole("link", { name: "모두 학습" });
    const clicked = vi.spyOn(study, "click").mockImplementation(() => undefined);
    const user = userEvent.setup();

    expect(study).toHaveAttribute("aria-keyshortcuts", "Enter");
    // Control: Enter on another link is that link's own.
    within(screen.getByRole("region", { name: "오늘 할 덱" }))
      .getByRole("link")
      .focus();
    await user.keyboard("{Enter}");
    expect(clicked).not.toHaveBeenCalled();
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard("{Enter}");
    expect(clicked).toHaveBeenCalledOnce();
  });

  it("shows the last 30 study days' retention against the 90% target with its gap, linking to the record page, and a sentence without a review", async () => {
    postgrest.seed("decks", deckRow("d-fr", "French"));
    postgrest.seed(
      "cards",
      cardRow("a", "d-fr", "chat"),
      cardRow("b", "d-fr", "chien"),
      cardRow("c", "d-fr", "oiseau"),
    );
    const answer = (id: string, card: string, ago: number, rating: "good" | "again") => ({
      ...reviewRow(id, card, start - ago, 4_000),
      rating,
    });
    // First answers alone hold no scheduled review.
    postgrest.seed(
      "reviews",
      answer("a1", "a", 10 * day, "good"),
      answer("b1", "b", 10 * day, "good"),
    );
    await render(Today, {});
    const card = () => within(screen.getByRole("region", { name: "기억률" }));
    expect(card().getByText("최근 30일 동안 복습한 카드가 없어요.")).toBeInTheDocument();
    expect(card().getByRole("link", { name: "기록에서 자세히 보기" })).toHaveAttribute(
      "href",
      "/record",
    );
    cleanup();

    // a's "안다" and b's "모른다" 5 days back are scheduled; c's "모른다" 45 days back is outside
    // the 30 days.
    postgrest.seed(
      "reviews",
      answer("a2", "a", 5 * day, "good"),
      answer("b2", "b", 5 * day, "again"),
      answer("c0", "c", 60 * day, "good"),
      answer("c-old", "c", 45 * day, "again"),
    );
    await render(Today, {});
    expect(card().getByText("50%")).toBeInTheDocument();
    expect(card().getByText("목표 90%")).toBeInTheDocument();
    expect(card().getByText("목표보다 40% 낮아요")).toBeInTheDocument();
    expect(card().getByRole("img").getAttribute("aria-label")).toBe(
      "최근 30일 복습에서 맞힌 비율, 목표 90%: 1월 10일 50%",
    );
    expect(card().getByRole("link", { name: "기록에서 자세히 보기" })).toHaveAttribute(
      "href",
      "/record",
    );
  });

  it("shows the first-run invitation in place of the today card on 오늘 and of the list on 덱 when there is no deck", async () => {
    const title = "첫 덱을 만들어 볼까요?";
    // Control: a user with one deck, its card not due, sees the done card and the list, and no
    // invitation.
    postgrest.seed("decks", deckRow("d-fr", "French"));
    postgrest.seed("cards", cardRow("c-chat", "d-fr", "chat"));
    postgrest.seed("card_states", stateRow("c-chat", notDue));
    await renderBoth();
    expect(screen.getByRole("heading", { name: "내 덱 1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "오늘 할 카드를 다 했어요" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: title })).not.toBeInTheDocument();
    cleanup();

    postgrest = new FakePostgrest();
    server.use(...postgrest.handlers);
    for (const page of [Today, Decks]) {
      await render(page, {});

      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
      // The first-run home is headed by the mark, the thinking mascot.
      expect(document.querySelector('img[src*="knowno-thinking"]')).not.toBeNull();
      expect(screen.queryByRole("heading", { name: /^오늘 할 카드/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "덱 목록" })).not.toBeInTheDocument();
      // First-run creation is available on the web.
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      const create = screen.getByRole("button", { name: "새 덱 만들기" });
      // On 오늘 the first deck is the page's one way on, in the coral fill.
      if (page === Today) expect(create).toHaveClass("bg-primary");
      cleanup();
    }
  });

  it("shows how to start in place of a finished day on 오늘 when the decks hold no card", async () => {
    const title = "첫 카드를 만들어 볼까요?";
    postgrest.seed("decks", deckRow("d-fr", "French"));
    await render(Today, {});

    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "오늘 할 카드를 다 했어요" }),
    ).not.toBeInTheDocument();
    // The happy mascot, glad of the deck just made (ADR 0141).
    expect(document.querySelector('img[src*="knowno-happy"]')).not.toBeNull();
    // Its one action adds a card to the one deck, in the coral fill.
    expect(screen.getByRole("button", { name: "카드 추가" })).toHaveClass("bg-primary");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    cleanup();

    // With several decks, it leads to the deck list instead.
    postgrest.seed("decks", deckRow("d-de", "German"));
    await render(Today, {});
    expect(screen.getByRole("link", { name: "덱에서 카드 추가" })).toHaveAttribute(
      "href",
      "/decks",
    );
    expect(screen.queryByRole("button", { name: "카드 추가" })).not.toBeInTheDocument();
    cleanup();

    // Control: with a card in the deck, the day shows.
    postgrest.seed("cards", cardRow("c-chat", "d-fr", "chat"));
    await render(Today, {});
    expect(screen.queryByRole("heading", { name: title })).not.toBeInTheDocument();
  });

  it("draws today's bar in the accent and the other days in the chart's other colour, on the last seven days and the catch-up, with no amber", async () => {
    /** The bars of the page's chart, by fill. */
    const bars = (fill: string) => document.querySelectorAll(`span.rounded-md.${fill}`).length;
    postgrest.seed("decks", deckRow("d-fr", "French"));
    postgrest.seed("cards", cardRow("c-chat", "d-fr", "chat"));
    await render(Today, {});
    expect(bars("bg-accent")).toBe(1);
    expect(bars("bg-chart-other")).toBe(6);
    cleanup();

    postgrest = new FakePostgrest();
    server.use(...postgrest.handlers);
    postgrest.seed("decks", deckRow("d-fr", "French"));
    const overdue = {
      stability: 30,
      difficulty: 5,
      lastReview: start - 31 * day,
      due: start - day,
    };
    const names = ["a", "b", "c"];
    postgrest.seed("cards", ...names.map((name) => cardRow(`c-${name}`, "d-fr", name)));
    postgrest.seed("card_states", ...names.map((name) => stateRow(`c-${name}`, overdue)));
    await render(Today, {});
    expect(screen.getByRole("heading", { name: "다시 시작하면 돼요" })).toBeInTheDocument();
    expect(bars("bg-accent")).toBe(1);
    expect(bars("bg-chart-other")).toBe(6);
    expect(bars("bg-streak")).toBe(0);
  });

  it("draws 오늘 and 덱 in three sizes, the title, the body and the caption, in every state", async () => {
    const overdue = {
      stability: 30,
      difficulty: 5,
      lastReview: start - 31 * day,
      due: start - day,
    };
    const states: [string, () => void][] = [
      ["첫 덱을 만들어 볼까요?", () => undefined],
      [
        "첫 카드를 만들어 볼까요?",
        () => {
          postgrest.seed("decks", deckRow("d-fr", "French"));
        },
      ],
      [
        "오늘 할 카드",
        () => {
          postgrest.seed("decks", deckRow("d-fr", "French"));
          postgrest.seed("cards", cardRow("c-chat", "d-fr", "chat"));
        },
      ],
      [
        "오늘 할 카드를 다 했어요",
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
      for (const page of [Today, Decks]) {
        await render(page, {});
        // The state the seed asked for, read on 오늘.
        if (page === Today)
          expect(screen.getByRole("heading", { name: state })).toBeInTheDocument();
        expect({ state, sizes: typeSizesOf(document.body) }).toEqual({
          state,
          // A first run is its heading, one sentence and one action: it draws no caption.
          sizes:
            state === "첫 덱을 만들어 볼까요?" || (state.startsWith("첫 ") && page === Today)
              ? [16, 28]
              : [13, 16, 28],
        });
        cleanup();
      }
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

      expect(screen.getByRole("heading", { name: "오늘 할 카드를 다 했어요" })).toBeInTheDocument();
      expect(screen.getByText("목표 30장 달성")).toBeInTheDocument();
      expect(screen.getByText("오늘 10장 더 했어요")).toBeInTheDocument();
      // Both chips are their words alone (ADR 0116).
      expect(screen.getByText("목표 30장 달성").querySelector("svg")).toBeNull();
      expect(screen.getByText("오늘 10장 더 했어요").querySelector("svg")).toBeNull();
      expect(chipTone(screen.getByText("오늘 10장 더 했어요"))).toBe("surface");
    });

    it("control: before the day is done, a planned card answered 모른다 stays left", async () => {
      seedDay(30, (index) => index === 0);
      await render(Today, {});

      expect(cardsLeft()).toBe(1);
      expect(screen.queryByText(/더 했어요$/)).not.toBeInTheDocument();
    });
  });
});
