import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEngine, studyDayStart } from "@/features/study";

import {
  cardRow,
  day,
  deckRow,
  reviewRow,
  seedDeck,
  side,
  start,
  stateRow,
  uuidOf,
} from "@/testing/library";
import { chipTone } from "@/testing/chip";
import { layOutLines, zoomOf } from "@/testing/line-widths";
import { supabaseUrl, testUser } from "@/testing/mocks/handlers";
import { FakePostgrest } from "@/testing/mocks/postgrest";
import { server } from "@/testing/mocks/server";
import { setRequestCookies } from "@/testing/next-headers";
import { render } from "@/testing/render";
import { testRouter } from "@/testing/router";
import { signedInCookies } from "@/testing/session";
import { sensesUnder } from "@/testing/senses";
import { blanksUnder } from "@/testing/whole-cards";

import { Study } from "../_components/study";

// The study screen starts its session once the browser's engine has loaded; its first load
// compiles the module.
beforeAll(async () => {
  await loadEngine();
}, 30_000);

vi.mock("next/headers", () => import("@/testing/next-headers"));

const hour = 3_600_000;

/** Opens the study page over the decks named [decks] at [at], as the browser would with `?decks=`. */
async function open(decks: string, at = start) {
  vi.setSystemTime(at);
  const ids = decks.split(",").map(uuidOf).join(",");
  await render(Study, { searchParams: Promise.resolve({ decks: ids }) });
  // The screen starts its session once the browser's engine has loaded, under the skeleton.
  await waitFor(() => {
    expect(screen.queryByText("카드를 불러오는 중이에요.")).not.toBeInTheDocument();
  });
}

/** The shared cases the phone's `framed_card_test.dart` reads, those with a list of 칸. */
const placements = (
  JSON.parse(
    readFileSync(
      path.join(import.meta.dirname, "../../../../../supabase/fixtures/card-frame/conversion.json"),
      "utf8",
    ),
  ) as { name: string; front: unknown[]; back: unknown[]; cells: unknown[] | null }[]
).flatMap(({ cells, ...placement }) => (cells ? [{ ...placement, cells }] : []));

/**
 * What study draws for each placement, by ADR 0137's and ADR 0140's tables: before the reveal, a
 * whole card as a screen reader reads it, its blanks being in the page and hidden, and a split
 * card's text; and the previous card's text, a split card's front and back run together.
 */
const drawn: Record<string, { whole: boolean; before: string; after: string; photo?: true }> = {
  "placement 1: an import's cloze, its back the filled text, drops the back": {
    whole: true,
    before: "The capital is 빈칸.",
    after: "The capital is Paris.",
  },
  "placement 1: a copy's cloze, its back edited, keeps the back": {
    whole: true,
    before: "The capital is 빈칸.",
    after: "The capital is Paris.Paris, on the Seine.",
  },
  "placement 2: an import's named table, its back the filled text, drops the back": {
    whole: true,
    before: "Capitals. Country, Capital. France, 빈칸",
    after: "CapitalsCountryCapitalFranceParis",
  },
  "placement 3: a former 빈칸 card with no back": {
    whole: true,
    before: "빈칸 is red.",
    after: "Rose is red.",
  },
  "placement 3 and O2: a written back beside a front blank shows after the answer": {
    whole: true,
    before: "빈칸 is red.",
    after: "Rose is red.A flower.",
  },
  "placement 4: a manual back equal to the filled text drops, whatever the source": {
    whole: true,
    before: "Colour. 빈칸 is red.",
    after: "ColourRose is red.",
  },
  "placement 4: a back text beside a front text is that text's back": {
    whole: true,
    before: "Colour. 빈칸 is red.",
    after: "ColourMine, edited.Rose is red.",
  },
  "placement 4: a front holding senses compares with no back, so an equal back is kept": {
    whole: true,
    before: "apple. 빈칸 is red.",
    after: "appleapple\nRose is red.Rose is red.",
  },
  "back blank beside a front blank: a cloze shows after the answer as filled text": {
    whole: true,
    before: "빈칸 is red.",
    after: "Rose is red.Sky is blue.",
  },
  "back blank beside a front blank: a table shows after the answer as filled text": {
    whole: true,
    before: "빈칸 is red.",
    after: "Rose is red.A\na",
  },
  "back blank beside a front blank: a boxed photo is placed on the back, its answers a 글": {
    whole: true,
    before: "빈칸 is red.",
    after: "Rose is red.Heart",
  },
  "placement 5: a back blank alone is a question": {
    whole: true,
    before: "Fill it. 빈칸 is red.",
    after: "Fill itRose is red.",
  },
  "placement 5 and O3: a back text beside a back blank shows after the answer": {
    whole: true,
    before: "Fill it. 빈칸 is red.",
    after: "Fill itA flower.Rose is red.",
  },
  "placement 6: a boxed photo on a front moves unchanged": {
    whole: true,
    before: "사진, 빈칸",
    after: "",
  },
  "placement 6: a boxed photo on a back alone is a question": {
    whole: true,
    before: "Name it. 사진, 빈칸",
    after: "Name it",
  },
  "placement 7: a literal ___ in text is a 글, no blank": {
    whole: false,
    before: "The ___ sat.",
    after: "The ___ sat.cat",
  },
  "no blank: a word with its senses is one 단어 asking the word": {
    whole: false,
    before: "apple",
    after: "apple사과fruit",
  },
  "no blank: front senses with a back word is one 단어 asking the meaning": {
    whole: false,
    before: "사과",
    after: "사과apple",
  },
  "no blank: front senses alone keep their meanings first": {
    whole: false,
    before: "사과",
    after: "사과",
  },
  "no blank: back senses that join no word show after the reveal": {
    whole: false,
    before: "onetwo",
    after: "onetwo사과",
  },
  // The photo is drawn on its side, as the phone draws it, and its frame holds no text.
  "no blank: photo and sound keep their sides": {
    whole: false,
    before: "",
    after: "소리",
    photo: true,
  },
};

/** The front of the card on screen. */
const currentFront = () => screen.getByRole("group", { name: "앞면" }).textContent;

/** The accessible names of this session's answers in the list beside the cards, oldest first. */
const stack = () =>
  within(screen.getByRole("complementary", { name: "이번 학습" }))
    .getAllByRole("button")
    .map((button) => button.getAttribute("aria-label"));

/** The cards column: the previous cards, as articles, and the current card. */
const cards = () => screen.getByRole("region", { name: "카드" });

/** The accessible names of the previous cards the column shows, top first. */
const shown = () =>
  within(cards())
    .queryAllByRole("article")
    .map((card) => card.getAttribute("aria-label"));

/** Answers every card shown with [key] until [count] cards have been shown; their fronts. */
/**
 * The new cards a day takes in these tests: the 5 daily minutes each test's server holds, at
 * 10 s a card, the pace while too few answers are stored.
 */
const todayNewCards = 30;

/** The study settings each test's server holds for the signed-in user: 5 daily minutes. */
const fiveMinutes = { daily_minutes: 5, updated_at: new Date(0).toISOString() };

/** [count] fronts, f00 onwards, created oldest first by `seedDeck`. */
function past(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `f${String(index).padStart(2, "0")}`);
}

async function answerAll(key: string, count: number) {
  const user = userEvent.setup();
  const fronts: string[] = [];
  for (let shown = 0; shown < count; shown++) {
    fronts.push(currentFront());
    await user.keyboard(key);
  }
  return fronts;
}

describe("the study page", () => {
  let postgrest: FakePostgrest;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // The coach has shown in this browser, unless a test clears it for a first session.
    window.localStorage.setItem("studyCoachShown", "true");
    setRequestCookies(await signedInCookies());
    postgrest = new FakePostgrest();
    postgrest.studySettings.set(testUser.id, fiveMinutes);
    server.use(...postgrest.handlers);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("its address", () => {
    it("leaves out an id that is not a uuid and studies the decks named by theirs, and is not found with none left", async () => {
      seedDeck(postgrest, "d1", ["un"]);
      vi.setSystemTime(start);
      await render(Study, { searchParams: Promise.resolve({ decks: `d1,${uuidOf("d1")}` }) });
      await waitFor(() => {
        expect(screen.queryByText("카드를 불러오는 중이에요.")).not.toBeInTheDocument();
      });
      expect(currentFront()).toBe("un");
      cleanup();

      await expect(
        render(Study, { searchParams: Promise.resolve({ decks: "d1" }) }),
      ).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    });
  });

  describe("queue", () => {
    const fronts = ["un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit"];

    /**
     * Opens a session over a fresh copy of the deck at [at], so no write of an earlier session
     * changes what it studies.
     */
    async function openFresh(at = start) {
      cleanup();
      postgrest = new FakePostgrest();
      postgrest.studySettings.set(testUser.id, fiveMinutes);
      server.use(...postgrest.handlers);
      seedDeck(postgrest, "d1", fronts);
      await open("d1", at);
    }

    it("orders the cards by the session's seeded random source", async () => {
      await openFresh();
      const first = await answerAll("{ArrowRight}", fronts.length);
      await openFresh();
      const again = await answerAll("{ArrowRight}", fronts.length);
      // Control: a session started at another time draws another order.
      await openFresh(start + 1);
      const other = await answerAll("{ArrowRight}", fronts.length);

      expect([...first].sort()).toEqual([...fronts].sort());
      expect(again).toEqual(first);
      expect(other).not.toEqual(first);
    });

    it("shows a card answered 모른다 again after 3 to 5 other cards, as the seed draws", async () => {
      const gaps: number[] = [];
      for (const at of [start, start]) {
        await openFresh(at);
        const [missed] = await answerAll("{ArrowLeft}", 1);
        const shown = await answerAll("{ArrowRight}", fronts.length);
        gaps.push(missed === undefined ? -1 : shown.indexOf(missed));
      }

      expect(gaps[0]).toBeGreaterThanOrEqual(3);
      expect(gaps[0]).toBeLessThanOrEqual(5);
      expect(gaps[1]).toBe(gaps[0]);
    });

    it("studies the due cards and the oldest new cards the daily minutes leave room for, and no card not yet due", async () => {
      const news = Array.from({ length: 35 }, (_, index) => `new ${String(index)}`);
      seedDeck(postgrest, "d1", news);
      postgrest.seed("cards", cardRow("due", "d1", "due"), cardRow("later", "d1", "later"));
      postgrest.seed(
        "card_states",
        stateRow("due", { stability: 3, difficulty: 5, lastReview: start - 4 * day, due: start }),
        stateRow("later", { stability: 9, difficulty: 5, lastReview: start, due: start + day }),
      );

      await open("d1");
      // (5 min - the due card at 10 s) / 10 s: 29 new cards.
      const shown = await answerAll("{ArrowRight}", 30);

      expect(screen.getByRole("progressbar", { name: "진행" })).toHaveAttribute(
        "aria-valuemax",
        "30",
      );
      expect([...shown].sort()).toEqual(["due", ...news.slice(0, 29)].sort());
      expect(screen.getByRole("heading", { name: "오늘 학습 완료" })).toBeInTheDocument();
    });
  });

  describe("writing", () => {
    it("shows the next card before the answer's write is answered", async () => {
      seedDeck(postgrest, "d1", ["un", "deux"]);
      await open("d1");
      const first = currentFront();
      const release = postgrest.hold("reviews");

      await userEvent.setup().keyboard("{ArrowRight}");

      expect(currentFront()).not.toBe(first);
      expect(stack()).toHaveLength(1);
      expect(postgrest.rows.reviews).toHaveLength(0);
      act(release);
      await waitFor(() => {
        expect(postgrest.rows.card_states).toHaveLength(1);
      });
      expect(postgrest.rows.reviews).toHaveLength(1);
    });

    it("says a write failed, keeps its answer, and sends it again on 다시 시도", async () => {
      seedDeck(postgrest, "d1", ["un", "deux", "trois"]);
      await open("d1");
      const user = userEvent.setup();
      const stop = postgrest.fail("reviews", 500);

      await user.keyboard("{ArrowRight}");
      await user.keyboard("{ArrowRight}");

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "응답을 저장하지 못했어요. 연결을 확인하고 다시 시도해 주세요.",
      );
      expect(stack()).toHaveLength(2);
      expect(postgrest.rows.reviews).toHaveLength(0);
      stop();
      await user.click(screen.getByRole("button", { name: "다시 시도" }));
      await waitFor(() => {
        expect(postgrest.rows.card_states).toHaveLength(2);
      });
      expect(postgrest.rows.reviews).toHaveLength(2);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("leaving with answers not saved", () => {
    /** The page's three ways out: the top bar's close, Esc, and the completion card's 그만하기. */
    const exits = {
      close: async () => {
        await userEvent.setup().click(closeLink());
      },
      Esc: async () => {
        await userEvent.setup().keyboard("{Escape}");
      },
      "the completion card": async () => {
        const completion = screen.getByRole("region", { name: "오늘 학습 완료" });
        await userEvent.setup().click(within(completion).getByRole("link", { name: "그만하기" }));
      },
    };
    const confirm = () => screen.queryByRole("dialog", { name: "저장하지 않고 나갈까요?" });
    /** The top bar's close, the 그만하기 that Esc follows. */
    const closeLink = () => {
      const link = screen
        .getAllByRole("link", { name: "그만하기" })
        .find((candidate) => candidate.getAttribute("aria-keyshortcuts") === "Escape");
      if (!link) throw new Error("no close in the top bar");
      return link;
    };

    it.each(Object.keys(exits) as (keyof typeof exits)[])(
      "by %s, sends the failed write again and, when it fails again, asks before leaving without it",
      async (way) => {
        seedDeck(postgrest, "d1", ["un"]);
        await open("d1");
        postgrest.fail("reviews", 500);
        await userEvent.setup().keyboard("{ArrowRight}");
        await screen.findByRole("alert");
        // The one card is answered, so the completion card shows.
        expect(screen.getByRole("region", { name: "오늘 학습 완료" })).toBeInTheDocument();

        await exits[way]();

        const dialog = await screen.findByRole("dialog", { name: "저장하지 않고 나갈까요?" });
        expect(dialog).toHaveTextContent("지금 나가면 저장하지 못한 응답 1개가 사라져요.");
        // The dialog takes the focus once it has mounted.
        await waitFor(() => {
          expect(within(dialog).getByRole("button", { name: "취소" })).toHaveFocus();
        });
        expect(testRouter.push).not.toHaveBeenCalled();
        // 취소 stays, the answer still waiting.
        await userEvent.setup().click(within(dialog).getByRole("button", { name: "취소" }));
        expect(confirm()).not.toBeInTheDocument();
        expect(screen.getByRole("alert")).toBeInTheDocument();
        expect(testRouter.push).not.toHaveBeenCalled();

        await exits[way]();
        await userEvent
          .setup()
          .click(
            within(
              await screen.findByRole("dialog", { name: "저장하지 않고 나갈까요?" }),
            ).getByRole("button", { name: "나가기" }),
          );
        expect(testRouter.push).toHaveBeenCalledExactlyOnceWith("/");
        expect(postgrest.rows.reviews).toHaveLength(0);
      },
    );

    it("sends the waiting answers and then leaves, without asking, when the server answers again", async () => {
      seedDeck(postgrest, "d1", ["un", "deux"]);
      await open("d1");
      const stop = postgrest.fail("reviews", 500);
      await userEvent.setup().keyboard("{ArrowRight}");
      await screen.findByRole("alert");
      stop();

      await exits.close();

      await waitFor(() => {
        expect(testRouter.push).toHaveBeenCalledExactlyOnceWith("/");
      });
      expect(confirm()).not.toBeInTheDocument();
      expect(postgrest.rows.reviews).toHaveLength(1);
    });

    it("sends the waiting answers and then returns to the deck page the session was opened from", async () => {
      seedDeck(postgrest, "d1", ["un", "deux"]);
      vi.setSystemTime(start);
      await render(Study, {
        searchParams: Promise.resolve({ decks: uuidOf("d1"), from: "deck" }),
      });
      await waitFor(() => {
        expect(screen.queryByText("카드를 불러오는 중이에요.")).not.toBeInTheDocument();
      });
      const stop = postgrest.fail("reviews", 500);
      await userEvent.setup().keyboard("{ArrowRight}");
      await screen.findByRole("alert");
      stop();

      await exits.close();

      await waitFor(() => {
        expect(testRouter.push).toHaveBeenCalledExactlyOnceWith(`/decks/${uuidOf("d1")}`);
      });
    });

    it("follows the close at once when every answer is saved", async () => {
      seedDeck(postgrest, "d1", ["un", "deux"]);
      await open("d1");
      await userEvent.setup().keyboard("{ArrowRight}");
      await waitFor(() => {
        expect(postgrest.rows.reviews).toHaveLength(1);
      });
      // Read after the screen's own handler, which runs at React's root, below the document.
      const heldBack: boolean[] = [];
      const listener = (event: Event) => {
        heldBack.push(event.defaultPrevented);
        event.preventDefault();
      };
      document.addEventListener("click", listener);
      try {
        await userEvent.setup().click(closeLink());
      } finally {
        document.removeEventListener("click", listener);
      }

      expect(heldBack).toEqual([false]);
      expect(testRouter.push).not.toHaveBeenCalled();
      expect(confirm()).not.toBeInTheDocument();
    });
  });

  describe("today", () => {
    /** Seeds "d1" with "un" and "deux", new, and "trois", answered 모른다 this morning. */
    function seedToday() {
      seedDeck(postgrest, "d1", ["un", "deux"]);
      postgrest.seed("cards", cardRow("trois", "d1", "trois"));
      postgrest.seed(
        "card_states",
        stateRow("trois", {
          stability: 1,
          difficulty: 5,
          lastReview: start - hour,
          due: start + 2 * day,
        }),
      );
      postgrest.seed(
        "reviews",
        { ...reviewRow("r-today", "trois", start - hour, 90_000), rating: "again" },
        reviewRow("r-yesterday", "trois", start - day, 1_000),
      );
    }

    /** The completion card's line of counts, as read: its paragraph's text. */
    /** The completion panel's streak line, under its heading. */
    const completionLine = () =>
      screen.getByRole("region", { name: "오늘 학습 완료" }).querySelector("p")?.textContent;

    /** The completion panel's tiles: each count, its colour class, and its name. */
    const completionTiles = () =>
      [...screen.getByRole("region", { name: "오늘 학습 완료" }).querySelectorAll("dl > div")].map(
        (tile) => ({
          count: tile.querySelector("dd")?.textContent,
          colour: tile
            .querySelector("dd")
            ?.className.match(/\btext-(know|dont-know-text|ink)\b/)?.[0],
          name: tile.querySelector("dt")?.textContent,
        }),
      );

    it("keeps a card answered 모른다 earlier today in today's list, and counts the day's cards done 안다", async () => {
      seedDeck(postgrest, "d1", ["un"]);
      postgrest.seed("cards", cardRow("deux", "d1", "deux"), cardRow("trois", "d1", "trois"));
      const tomorrow = { stability: 1, difficulty: 5, lastReview: start - hour, due: start + day };
      postgrest.seed("card_states", stateRow("deux", tomorrow), stateRow("trois", tomorrow));
      postgrest.seed(
        "reviews",
        // deux: 모른다 this morning, due tomorrow by its state; trois: 안다 this morning.
        { ...reviewRow("r-deux", "deux", start - hour, 1_000), rating: "again" },
        reviewRow("r-trois", "trois", start - hour, 1_000),
      );
      await open("d1");

      // trois is done; un, new, and deux, kept by today's list, are left.
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
      expect(screen.getByText("1/3")).toBeInTheDocument();
      const user = userEvent.setup();
      const fronts = [currentFront()];
      await user.keyboard("{ArrowRight}");
      fronts.push(currentFront());
      await user.keyboard("{ArrowRight}");
      expect(fronts.sort()).toEqual(["deux", "un"]);
      expect(screen.getByText("3/3")).toBeInTheDocument();
    });

    it("says in the progress bar's place, as a status, that it goes on with the day when a card of it is done, and nothing on the day's first session", async () => {
      seedDeck(postgrest, "d1", ["un"]);
      postgrest.seed("cards", cardRow("deux", "d1", "deux"));
      postgrest.seed(
        "card_states",
        stateRow("deux", {
          stability: 1,
          difficulty: 5,
          lastReview: start - hour,
          due: start + day,
        }),
      );
      postgrest.seed("reviews", reviewRow("r-deux", "deux", start - hour, 1_000));
      // A place 100 px wide, narrower than the notice's line.
      const restore = layOutLines(100);
      await open("d1");
      // It arrives once the status region is there, and leaves after 3 s, which
      // `live-regions.test.tsx` times with fake timers.
      const status = screen.getByRole("status");
      await waitFor(() => {
        expect(status).toHaveTextContent(/^이어서 해요 · 남은 1장 · 약 \d+분$/);
      });
      // In the progress bar's place, the bar hidden while it shows, as on the phone.
      const bar = screen.getByRole("progressbar", { hidden: true });
      expect(status.parentElement).toBe(bar.parentElement);
      expect(status.className).toContain("absolute inset-0");
      expect(bar.className).toContain("invisible");
      // On one line, shrunk to the place, as the phone fits it.
      expect(zoomOf(within(status).getByText(/^이어서 해요/))).toBeLessThan(1);
      restore();
      cleanup();

      // Control: with nothing done today, nothing is said.
      postgrest.rows.reviews = [];
      await open("d1");
      expect(screen.getByRole("status")).toBeEmptyDOMElement();
    });

    it("shows the completion panel on the hero surface in the current card's place, below the stack, once no card is left", async () => {
      seedToday();
      await open("d1");
      const user = userEvent.setup();
      // un and deux, new, and trois, answered 모른다 this morning, which today's list keeps until
      // it is answered 안다.
      await user.keyboard("{ArrowRight}");
      await user.keyboard("{ArrowRight}");
      expect(screen.getByRole("group", { name: "앞면" })).toBeInTheDocument();
      // While studying, no mascot is drawn.
      expect(document.querySelectorAll('img[src*="/brand/knowno-"]')).toHaveLength(0);
      await user.keyboard("{ArrowRight}");

      expect(screen.queryByRole("group", { name: "앞면" })).not.toBeInTheDocument();
      const completion = screen.getByRole("region", { name: "오늘 학습 완료" });
      const [previous] = within(cards()).getAllByRole("article");
      expect(previous?.compareDocumentPosition(completion)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      expect(stack()).toHaveLength(3);
      // On the hero surface, with yesterday and today in a row.
      expect(completion.className).toContain("bg-hero");
      expect(completionLine()).toBe("2일 연속");
      // This morning's 모른다 and the session's three 안다, in green and red; 90 s and the
      // session's time, rounded up.
      expect(completionTiles()).toEqual([
        { count: "3", colour: "text-know", name: "안다" },
        { count: "1", colour: "text-dont-know-text", name: "모른다" },
        { count: "2분", colour: "text-ink", name: "걸린 시간" },
      ]);
      // The happy mascot (ADR 0141), the screen's one.
      expect(document.querySelectorAll('img[src*="/brand/knowno-"]')).toHaveLength(1);
      expect(completion.querySelector('img[src*="knowno-happy"]')).not.toBeNull();
      // No new card is left past today's, so the card says so and 그만하기 takes the focus.
      expect(screen.getByText("더 학습할 카드가 없어요")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "학습하기" })).not.toBeInTheDocument();
      // The top bar's 그만하기 leaves too; the card's is the one in the card.
      const stop = within(completion).getByRole("link", { name: "그만하기" });
      expect(stop).toHaveFocus();
      expect(stop).toHaveAttribute("href", "/");
    });

    it("reads the streak before today in one request and counts today's answer with it", async () => {
      seedDeck(postgrest, "d1", ["un"]);
      // Yesterday and the day before hold an answer; the day before that does not.
      postgrest.seed(
        "reviews",
        reviewRow("r-1", "d1-0", start - day, 1_000),
        reviewRow("r-2", "d1-0", start - 2 * day, 1_000),
        reviewRow("r-4", "d1-0", start - 4 * day, 1_000),
      );
      await open("d1");
      await userEvent.setup().keyboard("{ArrowRight}");

      expect(completionLine()).toBe("3일 연속");
      expect(
        postgrest.requests.filter((request) => request === "POST rpc/study_streak_before"),
      ).toHaveLength(1);
      await waitFor(() => {
        expect(postgrest.rows.reviews).toHaveLength(4);
      });
    });

    it("draws the day's bar full, as the phone does, when another note's answers took the day's new cards", async () => {
      seedDeck(postgrest, "d1", past(todayNewCards));
      for (let index = 0; index < todayNewCards; index++) {
        postgrest.seed(
          "card_states",
          stateRow(`d1-${String(index)}`, {
            stability: 1,
            difficulty: 5,
            lastReview: start - hour,
            due: start + 2 * day,
          }),
        );
        postgrest.seed(
          "reviews",
          reviewRow(`r-${String(index)}`, `d1-${String(index)}`, start - hour, 1_000),
        );
      }
      postgrest.seed("decks", deckRow("d2", "d2"));
      postgrest.seed("cards", cardRow("d2-0", "d2", "neuf", 1_000));
      await open("d2");

      // The setup's case: no card of the day's plan in this note, and its new card past it.
      expect(currentFront()).toBe("neuf");
      const progress = screen.getByRole("progressbar", { name: "진행" });
      expect(progress).toHaveAttribute("aria-valuemax", "0");
      expect(progress.firstElementChild).toHaveStyle({ width: "100%" });
    });

    it("goes on with the new cards past today's on 학습하기, oldest first, each answer written and counted apart from the day's", async () => {
      const fronts = past(todayNewCards + 2);
      seedDeck(postgrest, "d1", fronts);
      await open("d1");
      await answerAll("{ArrowRight}", todayNewCards);
      await waitFor(() => {
        expect(postgrest.rows.reviews).toHaveLength(todayNewCards);
      });
      const studyOn = screen.getByRole("button", { name: "학습하기" });
      expect(studyOn).toHaveFocus();
      const progress = screen.getByRole("progressbar", { name: "진행" });

      await userEvent.setup().click(studyOn);
      expect(await answerAll("{ArrowRight}", 2)).toEqual(fronts.slice(todayNewCards));

      expect(screen.getByRole("progressbar", { name: "진행" })).toBe(progress);
      // The day's bar stays full; the two past it are counted apart.
      expect(progress.getAttribute("aria-valuetext")).toBe(
        `${String(todayNewCards)}장 중 ${String(todayNewCards)}장 끝냄`,
      );
      expect(chipTone(screen.getByText("추가 2장"))).toBe("brand-tint");
      expect(screen.getByText("오늘 계획 밖으로 2장 더 학습함")).toHaveClass("sr-only");
      expect(screen.getByText("더 학습할 카드가 없어요")).toBeInTheDocument();
      await waitFor(() => {
        expect(postgrest.rows.reviews).toHaveLength(todayNewCards + 2);
      });
    });

    it("says there is nothing to study when no card is left and none was answered today", async () => {
      postgrest.seed("decks", deckRow("d1", "d1"));
      postgrest.seed("cards", cardRow("later", "d1", "later"));
      postgrest.seed(
        "card_states",
        stateRow("later", {
          stability: 9,
          difficulty: 5,
          lastReview: start - day,
          due: start + day,
        }),
      );
      postgrest.seed("reviews", reviewRow("r-yesterday", "later", start - day, 1_000));

      await open("d1");

      expect(screen.getByText("오늘은 학습할 카드가 없어요")).toBeInTheDocument();
      expect(document.querySelector('img[src*="knowno-sleepy"]')).not.toBeNull();
      // Its way back is a button as well as the ✕, the screen's one coral fill.
      expect(screen.getByRole("link", { name: "닫기" })).toHaveClass("bg-primary");
      expect(screen.queryByRole("progressbar", { name: "진행" })).not.toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "오늘 학습 완료" })).not.toBeInTheDocument();
      expect(screen.queryByRole("group", { name: "앞면" })).not.toBeInTheDocument();

      // Control: the same card answered this morning opens on the completion card.
      cleanup();
      postgrest.seed("reviews", reviewRow("r-today", "later", start - hour, 1_000));
      await open("d1");
      expect(screen.getByRole("region", { name: "오늘 학습 완료" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "닫기" })).not.toBeInTheDocument();
      expect(screen.queryByText("오늘은 학습할 카드가 없어요")).not.toBeInTheDocument();
      expect(document.querySelector('img[src*="knowno-sleepy"]')).toBeNull();
    });
  });

  describe("cards", () => {
    const fronts = ["un", "deux", "trois", "quatre", "cinq"];

    /** Answers the first three cards 안다, 모른다 and 안다; their fronts. */
    async function answerThree() {
      const user = userEvent.setup();
      const answered: string[] = [];
      for (const key of ["{ArrowRight}", "{ArrowLeft}", "{ArrowRight}"]) {
        answered.push(currentFront());
        await user.keyboard(key);
      }
      return answered;
    }

    /** An answer's name in the list beside the cards. */
    const listed = (front: string, answer: string) =>
      `앞면: ${front}. 뒷면: ${front} back. 응답: ${answer}`;

    /** The previous card's name: "방금 본 카드" and its grade first, then its sides (ADR 0151). */
    const label = (front: string, answer: string) =>
      `방금 본 카드, ${answer}. 앞면: ${front}. 뒷면: ${front} back`;

    /** Touches the previous card at (200, 100), moves to each of [moves] [step] ms apart, lifts. */
    function swipe(card: HTMLElement, moves: [number, number][], step = 1) {
      const from: [number, number] = [200, 100];
      const [x, y] = from;
      fireEvent.pointerDown(card, { pointerId: 1, pointerType: "touch", clientX: x, clientY: y });
      let at: [number, number] = from;
      for (const move of moves) {
        vi.setSystemTime(Date.now() + step);
        at = move;
        fireEvent.pointerMove(card, {
          pointerId: 1,
          pointerType: "touch",
          clientX: move[0],
          clientY: move[1],
        });
      }
      fireEvent.pointerUp(card, {
        pointerId: 1,
        pointerType: "touch",
        clientX: at[0],
        clientY: at[1],
      });
    }

    /** The previous card on screen. */
    const previousCard = () => within(cards()).getByRole("article");

    it("shows exactly the previous card and the current card, in two rows of one height", async () => {
      seedDeck(postgrest, "d1", fronts);
      await open("d1");
      const [, , third] = await answerThree();

      expect(shown()).toEqual([label(third ?? "", "안다")]);
      const current = within(cards()).getByRole("region", { name: "현재 카드" });
      // Both in one grid whose rows share the tallest one's height.
      expect(current.parentElement?.className).toContain("auto-rows-fr");
      expect(current.parentElement).toContainElement(previousCard());
      // The front over the back, in one column that scrolls inside the card.
      const front = within(previousCard()).getByText(third ?? "");
      const back = within(previousCard()).getByText(`${third ?? ""} back`);
      expect(front.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(front.parentElement).toBe(back.parentElement);
      expect(front.parentElement?.className).toContain("overflow-y-auto");
      expect(front.parentElement?.className).toContain("flex-col");
      // Centred both ways by auto margins, so a long side scrolls from its top, never cut.
      expect(front.className).toContain("mt-auto");
      expect(front.parentElement?.lastElementChild?.className).toContain("mb-auto");
      expect(front.className).not.toContain("line-clamp");
      expect(back.className).toContain("text-card-body");
      // Control: the list beside holds all three.
      expect(stack()).toHaveLength(3);
    });

    it("reaches no earlier card with ↑, ↓, the wheel or a vertical drag, and ← and → answer the current card alone", async () => {
      seedDeck(postgrest, "d1", fronts);
      await open("d1");
      const [, , third] = await answerThree();
      const user = userEvent.setup();
      const rest = [label(third ?? "", "안다")];
      const current = currentFront();

      await user.keyboard("{ArrowUp}");
      fireEvent.wheel(cards(), { deltaY: -300 });
      swipe(previousCard(), [
        [200, 200],
        [200, 400],
      ]);
      await user.keyboard("{ArrowDown}");
      expect(shown()).toEqual(rest);
      expect(currentFront()).toBe(current);
      expect(screen.queryByRole("button", { name: "지금 카드로" })).not.toBeInTheDocument();

      await user.keyboard("{ArrowLeft}");
      expect(currentFront()).not.toBe(current);
      expect(stack()).toHaveLength(4);
      expect(shown()).toEqual([label(current, "모른다")]);
      expect(stack()[2]).toBe(listed(third ?? "", "안다"));
    });

    it("closes the whole card on a click outside it, not inside, with the focus back on the card", async () => {
      seedDeck(postgrest, "d1", fronts);
      await open("d1");
      await answerThree();
      const user = userEvent.setup();
      const face = within(previousCard()).getByRole("button", { name: "카드 전체 보기" });
      await user.click(face);
      const detail = screen.getByRole("dialog", { name: "카드" });

      // Control: a click inside the card keeps it open.
      await user.click(within(detail).getByRole("heading", { name: "카드" }));
      expect(screen.getByRole("dialog", { name: "카드" })).toBeInTheDocument();
      await user.click(detail.parentElement ?? detail);

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(face).toHaveFocus();
    });

    it("bounds 이번 학습 to the screen with a list that scrolls on its own, to the newest answer as each is added", async () => {
      seedDeck(postgrest, "d1", fronts);
      await open("d1");
      const user = userEvent.setup();
      await user.keyboard("{ArrowRight}");
      const aside = screen.getByRole("complementary", { name: "이번 학습" });
      const list = within(aside).getByRole("list");
      expect(aside.className.split(" ")).toContain("max-h-[calc(100dvh-3rem)]");
      expect(list.className.split(" ")).toEqual(
        expect.arrayContaining(["min-h-0", "overflow-y-auto"]),
      );
      // jsdom lays nothing out, so the list is given the height its answers would take.
      Object.defineProperty(list, "scrollHeight", { configurable: true, value: 900 });
      expect(list.scrollTop).toBe(0);

      await user.keyboard("{ArrowLeft}");

      expect(within(list).getAllByRole("button")).toHaveLength(2);
      expect(list.scrollTop).toBe(900);
    });

    it("opens the previous card whole on a click, and closes it on 닫기 or Esc with the focus back on the card", async () => {
      seedDeck(postgrest, "d1", fronts);
      await open("d1");
      const [, , third] = await answerThree();
      const user = userEvent.setup();
      const open_ = within(previousCard()).getByRole("button", { name: "카드 전체 보기" });

      await user.click(open_);
      let detail = screen.getByRole("dialog", { name: "카드" });
      expect(within(detail).getByText(third ?? "")).toBeInTheDocument();
      expect(within(detail).getByText(`${third ?? ""} back`)).toBeInTheDocument();
      expect(within(detail).getByText("응답: 안다")).toBeInTheDocument();
      expect(within(detail).getByRole("button", { name: "닫기" })).toHaveFocus();
      // The answer is changed by a swipe or Z, not from here.
      expect(within(detail).getAllByRole("button")).toHaveLength(1);
      await user.click(within(detail).getByRole("button", { name: "닫기" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(open_).toHaveFocus();

      await user.click(open_);
      detail = screen.getByRole("dialog", { name: "카드" });
      // Keys belong to the dialog while it is open: → answers nothing.
      const current = currentFront();
      await user.keyboard("{ArrowRight}");
      expect(currentFront()).toBe(current);
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(open_).toHaveFocus();
      expect(shown()).toEqual([label(third ?? "", "안다")]);
    });

    it("changes the previous card's answer on a touch swipe past 100 or a fling toward the other answer, and writes the replay", async () => {
      seedDeck(postgrest, "d1", fronts);
      await open("d1");
      const [, , third] = await answerThree();
      await waitFor(() => {
        expect(postgrest.rows.reviews).toHaveLength(3);
      });
      const current = currentFront();

      // Toward 안다, the answer it has: nothing changes.
      swipe(previousCard(), [
        [260, 100],
        [400, 100],
      ]);
      expect(shown()).toEqual([label(third ?? "", "안다")]);
      // Short of 100 and slow, toward 모른다: nothing changes.
      swipe(
        previousCard(),
        [
          [190, 100],
          [180, 100],
          [170, 100],
          [160, 100],
          [150, 100],
          [140, 100],
          [130, 100],
          [120, 100],
        ],
        100,
      );
      expect(shown()).toEqual([label(third ?? "", "안다")]);
      // A vertical swipe, far and fast, is the card's own scroll: the browser keeps it
      // (touch-action: pan-y) for the face, which scrolls inside, and nothing changes.
      expect(previousCard().className).toContain("touch-pan-y");
      expect(previousCard().querySelector(".overflow-y-auto")).not.toBeNull();
      swipe(previousCard(), [
        [190, 60],
        [170, -150],
      ]);
      expect(shown()).toEqual([label(third ?? "", "안다")]);
      expect(currentFront()).toBe(current);
      // Control: past 100 toward 모른다, it changes, and the current card stays.
      vi.setSystemTime(start + 60_000);
      swipe(previousCard(), [
        [150, 100],
        [80, 100],
      ]);
      expect(shown()).toEqual([`${label(third ?? "", "모른다")}. 수정됨`]);
      expect(currentFront()).toBe(current);
      await waitFor(() => {
        expect(postgrest.rows.reviews.filter((row) => row.rating === "again")).toHaveLength(2);
      });
      expect(postgrest.rows.reviews).toHaveLength(3);

      // A fling: 40 in a millisecond, toward 안다.
      swipe(previousCard(), [
        [210, 100],
        [250, 100],
      ]);
      expect(shown()).toEqual([label(third ?? "", "안다")]);
    });

    it("draws no mascot while a card is studied, at rest or while either card is swiped toward either answer", async () => {
      seedDeck(postgrest, "d1", fronts);
      await open("d1");
      await answerThree();
      const mascots = () => document.querySelectorAll('img[src*="/brand/knowno-"], svg.mascot');
      // Control: the setup is a session studying, both cards on screen.
      const current = within(cards()).getByRole("region", { name: "현재 카드" });
      expect(previousCard()).toBeInTheDocument();
      expect(mascots()).toHaveLength(0);

      for (const [card, x] of [
        [current, 260],
        [current, 140],
        [previousCard(), 140],
        [previousCard(), 260],
      ] as const) {
        fireEvent.pointerDown(card, {
          pointerId: 1,
          pointerType: "touch",
          clientX: 200,
          clientY: 100,
        });
        fireEvent.pointerMove(card, {
          pointerId: 1,
          pointerType: "touch",
          clientX: x,
          clientY: 100,
        });
        expect(mascots()).toHaveLength(0);
        vi.setSystemTime(Date.now() + 500);
        fireEvent.pointerUp(card, { pointerId: 1, pointerType: "touch", clientX: x, clientY: 100 });
      }
    });

    it("shows the answer a swipe would give behind the previous card, and no detail opens when it ends", async () => {
      seedDeck(postgrest, "d1", fronts);
      await open("d1");
      await answerThree();
      const card = previousCard();

      fireEvent.pointerDown(card, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 200,
        clientY: 100,
      });
      fireEvent.pointerMove(card, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 150,
        clientY: 100,
      });
      expect(within(card).getByText("모른다로 바꿔요")).toBeInTheDocument();
      const face = within(card).getByRole("button", { name: "카드 전체 보기" });
      expect(face.style.transform).toContain("translateX(-50px)");
      vi.setSystemTime(Date.now() + 500);
      fireEvent.pointerUp(card, { pointerId: 1, pointerType: "touch", clientX: 150, clientY: 100 });
      fireEvent.click(face);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(within(card).queryByText("모른다로 바꿔요")).not.toBeInTheDocument();
      expect(face.style.transform).toContain("translateX(0px)");
    });

    /** The current card on screen. */
    const currentCard = () => within(cards()).getByRole("region", { name: "현재 카드" });

    it("answers the current card on a touch swipe past 100 or a fling, and not on a short, slow, vertical or mouse drag", async () => {
      seedDeck(postgrest, "d1", fronts);
      await open("d1");
      const first = currentFront();

      // Short of 100 and slow, toward 안다: nothing is answered.
      swipe(
        currentCard(),
        [
          [210, 100],
          [220, 100],
          [230, 100],
          [240, 100],
          [250, 100],
          [260, 100],
          [270, 100],
          [280, 100],
        ],
        100,
      );
      // Vertical: the page scrolls, and nothing is answered.
      swipe(currentCard(), [
        [200, 200],
        [200, 400],
      ]);
      // A mouse drags nothing.
      fireEvent.pointerDown(currentCard(), { pointerId: 2, pointerType: "mouse", clientX: 200 });
      fireEvent.pointerMove(currentCard(), { pointerId: 2, pointerType: "mouse", clientX: 400 });
      fireEvent.pointerUp(currentCard(), { pointerId: 2, pointerType: "mouse", clientX: 400 });
      expect(currentFront()).toBe(first);
      expect(shown()).toEqual([]);

      // Control: past 100 toward 안다, it is answered 안다 and rises into the previous card's place.
      vi.setSystemTime(Date.now() + 60_000);
      swipe(currentCard(), [
        [260, 100],
        [320, 100],
      ]);
      expect(shown()).toEqual([label(first, "안다")]);
      const second = currentFront();
      expect(second).not.toBe(first);
      await waitFor(() => {
        expect(postgrest.rows.reviews).toHaveLength(1);
      });

      // A fling: 40 in a millisecond, toward 모른다.
      swipe(currentCard(), [
        [190, 100],
        [150, 100],
      ]);
      expect(shown()).toEqual([label(second, "모른다")]);
      // The swipe on the current card moved it alone: the earlier answer stays 안다.
      expect(stack()).toEqual([listed(first, "안다"), listed(second, "모른다")]);
    });

    it("shows the next card at rest after a swipe answers, not easing in from where the finger let go", async () => {
      seedDeck(postgrest, "d1", fronts);
      await open("d1");
      const first = currentFront();
      const face = () => within(currentCard()).getByRole("group", { name: "앞면" }).parentElement;

      // Control: a swipe short of an answer springs the same face back, easing under motion-safe.
      const short = face();
      swipe(
        currentCard(),
        [
          [230, 100],
          [250, 100],
        ],
        200,
      );
      expect(currentFront()).toBe(first);
      expect(face()).toBe(short);
      expect(short?.style.transform).toContain("translateX(0px)");
      expect(short?.className.split(" ")).toContain("motion-safe:transition-transform");

      const released = face();
      fireEvent.pointerDown(currentCard(), {
        pointerId: 1,
        pointerType: "touch",
        clientX: 200,
        clientY: 100,
      });
      fireEvent.pointerMove(currentCard(), {
        pointerId: 1,
        pointerType: "touch",
        clientX: 320,
        clientY: 100,
      });
      expect(released?.style.transform).toContain("translateX(120px)");
      vi.setSystemTime(Date.now() + 500);
      fireEvent.pointerUp(currentCard(), {
        pointerId: 1,
        pointerType: "touch",
        clientX: 320,
        clientY: 100,
      });

      expect(shown()).toEqual([label(first, "안다")]);
      // The face that held the release offset is gone; the next card's face is a new one at rest,
      // with nothing to ease from.
      expect(released?.isConnected).toBe(false);
      expect(face()?.style.transform).toContain("translateX(0px)");
    });

    it("shows the answer a swipe on the current card would give behind it, and springs back short of it", async () => {
      seedDeck(postgrest, "d1", fronts);
      await open("d1");
      const card = currentCard();
      const front = currentFront();

      fireEvent.pointerDown(card, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 200,
        clientY: 100,
      });
      fireEvent.pointerMove(card, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 250,
        clientY: 100,
      });
      expect(within(card).getByText("안다")).toBeInTheDocument();
      const face = within(card).getByRole("group", { name: "앞면" }).parentElement;
      expect(face?.style.transform).toContain("translateX(50px)");
      expect(card.className.split(" ")).toContain("touch-pan-y");
      vi.setSystemTime(Date.now() + 500);
      fireEvent.pointerUp(card, { pointerId: 1, pointerType: "touch", clientX: 250, clientY: 100 });
      expect(within(card).queryByText("안다")).not.toBeInTheDocument();
      expect(face?.style.transform).toContain("translateX(0px)");
      expect(currentFront()).toBe(front);
    });

    it("grades the previous card by a 3 px line alone on the surface, which a change follows, with no chip, its name and its whole card naming the answer", async () => {
      seedDeck(postgrest, "d1", fronts);
      await open("d1");
      const user = userEvent.setup();
      const lineOf = () =>
        within(previousCard()).getByRole("button", { name: "카드 전체 보기" }).firstElementChild
          ?.className ?? "";

      for (const [key, answer, line] of [
        ["{ArrowRight}", "안다", "border-know"],
        ["{ArrowLeft}", "모른다", "border-dont-know-text"],
      ] as const) {
        const front = currentFront();
        await user.keyboard(key);
        expect(previousCard()).toHaveAccessibleName(label(front, answer));
        const face = within(previousCard()).getByRole("button", { name: "카드 전체 보기" });
        expect(lineOf().split(" ")).toEqual(
          expect.arrayContaining(["border-3", "bg-surface", line]),
        );
        // Nothing on the card but its sides: no word or mark of the grade.
        expect(within(previousCard()).queryByText(answer)).not.toBeInTheDocument();
        expect(face.querySelector("svg")).toBeNull();
        // The whole card still states the grade in words.
        await user.click(face);
        const detail = screen.getByRole("dialog", { name: "카드" });
        expect(within(detail).getByText(answer)).toBeInTheDocument();
        await user.keyboard("{Escape}");
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      }
      // Changed to 안다, the line turns green.
      await user.keyboard("z");
      expect(lineOf().split(" ")).toContain("border-know");
      expect(lineOf().split(" ")).not.toContain("border-dont-know-text");
    });

    it("holds the previous card's place with a dashed outline, an up arrow and its line on a day's first session, until its first answer", async () => {
      const placeholder = () =>
        screen.queryByRole("region", { name: "응답한 카드가 여기에 쌓여요" });
      seedDeck(postgrest, "d1", ["un", "deux"]);
      await open("d1");

      expect(placeholder()).toBeInTheDocument();
      expect(placeholder()?.className).toContain("border-dashed");
      expect(placeholder()?.querySelector("svg")).not.toBeNull();
      expect(screen.queryByText("지난번 마지막 카드")).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toBeEmptyDOMElement();
      const user = userEvent.setup();
      await user.keyboard("{ArrowLeft}");
      expect(placeholder()).not.toBeInTheDocument();
      expect(shown()).toHaveLength(1);
      // A "모른다" puts its card back; the outline does not return.
      await user.keyboard("{ArrowRight}");
      expect(placeholder()).not.toBeInTheDocument();
    });

    it("opens straight on the new cards past today's when none is left today, under the day's last card from an earlier session, until its first answer", async () => {
      // The first day's new cards answered this morning, and two more.
      const fronts = past(todayNewCards + 2);
      seedDeck(postgrest, "d1", fronts);
      for (let index = 0; index < todayNewCards; index++) {
        postgrest.seed(
          "card_states",
          stateRow(`d1-${String(index)}`, {
            stability: 1,
            difficulty: 5,
            lastReview: start - hour,
            due: start + 2 * day,
          }),
        );
        postgrest.seed(
          "reviews",
          reviewRow(`r-${String(index)}`, `d1-${String(index)}`, start - hour, 1_000),
        );
      }
      await open("d1");

      expect(screen.queryByRole("region", { name: "오늘 학습 완료" })).not.toBeInTheDocument();
      expect(currentFront()).toBe(fronts[todayNewCards]);
      expect(shown()).toEqual([
        expect.stringMatching(/^지난번 마지막 카드\. 앞면: f\d\d\. .*응답: 안다$/),
      ]);
      // No card of the day's is left, so nothing goes on to say.
      expect(screen.getByRole("status")).toBeEmptyDOMElement();

      await userEvent.setup().keyboard("{ArrowRight}");
      expect(currentFront()).toBe(fronts[todayNewCards + 1]);
      expect(screen.queryByText("지난번 마지막 카드")).not.toBeInTheDocument();
    });

    it("springs the previous card back only under prefers-reduced-motion: no-preference", async () => {
      seedDeck(postgrest, "d1", fronts);
      await open("d1");
      await answerThree();

      const face = within(previousCard()).getByRole("button", { name: "카드 전체 보기" });
      expect(face.className.split(" ").filter((name) => name.includes("transition"))).toEqual([
        "motion-safe:transition-transform",
      ]);
    });
  });

  describe("keyboard", () => {
    beforeEach(async () => {
      seedDeck(postgrest, "d1", ["un", "deux", "trois", "quatre", "cinq"]);
      await open("d1");
    });

    it("shows the current card's front alone, with no back to reveal, on Space or otherwise", async () => {
      const card = screen.getByRole("region", { name: "현재 카드" });
      const front = currentFront();
      // The card holds one of the seeded fronts and nothing else.
      expect(["un", "deux", "trois", "quatre", "cinq"]).toContain(card.textContent);
      expect(card).not.toHaveTextContent(`${front} back`);
      expect(screen.queryByRole("group", { name: "뒷면" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "뒷면 보기" })).not.toBeInTheDocument();

      await userEvent.setup().keyboard(" ");

      expect(card).not.toHaveTextContent(`${front} back`);
      expect(currentFront()).toBe(front);
      // Control: the answer shows once answered, on the previous card.
      await userEvent.setup().keyboard("{ArrowRight}");
      expect(stack()).toEqual([`앞면: ${front}. 뒷면: ${front} back. 응답: 안다`]);
    });

    it.each([
      ["→", "{ArrowRight}", "안다"],
      ["←", "{ArrowLeft}", "모른다"],
    ])("answers with %s", async (_name, key, answer) => {
      const front = currentFront();

      await userEvent.setup().keyboard(key);

      expect(stack()).toEqual([`앞면: ${front}. 뒷면: ${front} back. 응답: ${answer}`]);
      expect(currentFront()).not.toBe(front);
    });

    it("answers nothing with J or K, while → does", async () => {
      const user = userEvent.setup();
      const front = currentFront();

      await user.keyboard("jkJK");

      expect(shown()).toEqual([]);
      expect(currentFront()).toBe(front);
      // Control: the arrow key answers the same card.
      await user.keyboard("{ArrowRight}");
      expect(stack()).toEqual([`앞면: ${front}. 뒷면: ${front} back. 응답: 안다`]);
    });

    it("toggles the last answer on Z or 마지막 응답 바꾸기, shown at every width", async () => {
      const user = userEvent.setup();
      await user.keyboard("{ArrowRight}");
      await user.keyboard("{ArrowLeft}");

      await user.keyboard("z");

      expect(stack()[0]).toMatch(/응답: 안다$/);
      expect(stack()[1]).toMatch(/응답: 안다. 수정됨$/);
      const toggle = screen.getByRole("button", { name: "마지막 응답 바꾸기" });
      expect(toggle.className.split(" ")).not.toContain("hidden");
      await user.click(toggle);
      expect(stack()[1]).toMatch(/응답: 모른다$/);
    });

    it("leaves on Esc for the deck page it was opened from", async () => {
      cleanup();
      await render(Study, {
        searchParams: Promise.resolve({ decks: uuidOf("d1"), from: "deck" }),
      });
      await waitFor(() => {
        expect(screen.queryByText("카드를 불러오는 중이에요.")).not.toBeInTheDocument();
      });
      const close = screen.getByRole("link", { name: "그만하기" });
      const followed = vi.fn();
      close.addEventListener("click", (event) => {
        event.preventDefault();
        followed();
      });

      await userEvent.setup().keyboard("{Escape}");

      expect(close).toHaveAttribute("href", `/decks/${uuidOf("d1")}`);
      expect(followed).toHaveBeenCalledOnce();
    });

    it("leaves for 오늘 on Esc", async () => {
      const user = userEvent.setup();
      const close = screen.getByRole("link", { name: "그만하기" });
      const followed = vi.fn();
      close.addEventListener("click", (event) => {
        event.preventDefault();
        followed();
      });
      await user.keyboard("{ArrowRight}");

      await user.keyboard("{Escape}");

      expect(close).toHaveAttribute("href", "/");
      expect(followed).toHaveBeenCalledOnce();
    });

    it("keeps Tab and Shift+Tab inside the shortcut list, on its 닫기", async () => {
      const user = userEvent.setup();
      await user.keyboard("{ArrowRight}");

      await user.keyboard("?");
      const close = within(screen.getByRole("dialog", { name: "단축키" })).getByRole("button", {
        name: "닫기",
      });
      expect(close).toHaveFocus();
      await user.tab();
      expect(close).toHaveFocus();
      await user.tab({ shift: true });
      expect(close).toHaveFocus();
      await user.keyboard("{Escape}");
      expect(screen.getByRole("button", { name: "단축키" })).toHaveFocus();
    });

    it("keeps Tab and Shift+Tab inside the whole card, on its 닫기", async () => {
      const user = userEvent.setup();
      await user.keyboard("{ArrowRight}");

      const face = screen.getByRole("button", { name: "카드 전체 보기" });
      await user.click(face);
      const done = within(screen.getByRole("dialog", { name: "카드" })).getByRole("button", {
        name: "닫기",
      });
      expect(done).toHaveFocus();
      await user.tab();
      expect(done).toHaveFocus();
      await user.tab({ shift: true });
      expect(done).toHaveFocus();
      await user.keyboard("{Escape}");
      expect(face).toHaveFocus();
    });

    it("closes the shortcut list on a click outside it, not inside, with the focus back on 단축키", async () => {
      const user = userEvent.setup();
      await user.keyboard("?");
      const help = screen.getByRole("dialog", { name: "단축키" });

      // Control: a click inside the list keeps it open.
      await user.click(within(help).getByText("마지막 응답 바꾸기"));
      expect(screen.getByRole("dialog", { name: "단축키" })).toBeInTheDocument();
      await user.click(help.parentElement ?? help);

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "단축키" })).toHaveFocus();
    });

    it("lists every shortcut on ?, and closes the list on Esc without ending the session", async () => {
      const user = userEvent.setup();

      await user.keyboard("?");

      const help = screen.getByRole("dialog", { name: "단축키" });
      const listed = within(help)
        .getAllByRole("definition")
        .map((action) => [
          action.textContent,
          Array.from(
            action.previousElementSibling?.querySelectorAll("kbd") ?? [],
            (key) => key.textContent,
          ),
        ]);
      expect(listed).toEqual([
        ["안다", ["→"]],
        ["모른다", ["←"]],
        ["마지막 응답 바꾸기", ["Z"]],
        ["그만하기", ["Esc"]],
        ["단축키 보기", ["?"]],
      ]);
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByRole("group", { name: "앞면" })).toBeInTheDocument();
    });

    it("mirrors each shortcut with a visible control", async () => {
      await userEvent.setup().keyboard("{ArrowRight}");

      const controls = Object.fromEntries(
        ["안다", "모른다", "마지막 응답 바꾸기", "그만하기", "단축키"].map((name) => [
          name,
          screen
            .getByRole(name === "그만하기" ? "link" : "button", { name })
            .getAttribute("aria-keyshortcuts"),
        ]),
      );

      expect(controls).toEqual({
        안다: "ArrowRight",
        모른다: "ArrowLeft",
        "마지막 응답 바꾸기": "Z",
        그만하기: "Escape",
        단축키: "?",
      });
      // An answer button is its word and its key, with no arrow icon repeating the key (ADR 0116).
      for (const name of ["안다", "모른다"]) {
        const answer = screen.getByRole("button", { name });
        expect(answer.querySelector("svg"), name).toBeNull();
        expect(answer.textContent, name).toBe(name === "안다" ? "안다 →" : "모른다 ←");
      }
      // Control: the close keeps its icon.
      expect(screen.getByRole("link", { name: "그만하기" }).querySelector("svg")).not.toBeNull();
    });
  });

  it("gives 안다, 모른다 and the screen's other controls the shared hover and pressed state", async () => {
    seedDeck(postgrest, "d1", ["un", "deux", "trois"]);
    await open("d1");
    // 마지막 응답 바꾸기 shows once a card is answered.
    await userEvent.setup().keyboard("{ArrowRight}");

    for (const name of [/^안다/, /^모른다/, "안내 다시 보기", "마지막 응답 바꾸기", "단축키"]) {
      expect(screen.getByRole("button", { name }).className.split(" ")).toContain("pressable");
    }
    expect(screen.getByRole("link", { name: "그만하기" }).className.split(" ")).toContain(
      "pressable",
    );
  });

  describe("the coach", () => {
    const caption = () => screen.queryByRole("region", { name: "학습 사용 방법" });
    /** What the screen's live region announces of the coach. */
    const announced = () => document.querySelector('[aria-live="polite"]')?.textContent;
    const answerButton = (name: string) =>
      screen.queryByRole("button", { name: new RegExp(`^${name}`) });
    /** Whether the pointer coach marks [element] as the control its step names. */
    const highlighted = (element: HTMLElement | null) =>
      element?.className.includes("outline-hero") ?? false;
    /** Whether [element] is left to screen readers, drawn nowhere. */
    const unseen = (element: HTMLElement | null) => element?.classList.contains("sr-only");

    /** Makes the page one used by touch, `(pointer: coarse)`, until the test's end. */
    function byTouch() {
      // The code under test reads `matches` only; the deprecated addListener and removeListener
      // are left out of the stand-in.
      vi.stubGlobal(
        "matchMedia",
        (query: string): Omit<MediaQueryList, "addListener" | "removeListener"> => ({
          matches: query === "(pointer: coarse)",
          media: query,
          onchange: null,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          dispatchEvent: () => false,
        }),
      );
    }

    beforeEach(() => {
      // A device's first session.
      window.localStorage.removeItem("studyCoachShown");
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("by touch teaches the phone's swipes under a hand, presented by the mascot, the caption its bubble in the controls' row", async () => {
      byTouch();
      expect(window.matchMedia("(pointer: coarse)").matches).toBe(true);
      seedDeck(postgrest, "d1", ["un", "deux"]);
      await open("d1");
      await screen.findByRole("region", { name: "학습 사용 방법" });
      const user = userEvent.setup();

      expect(announced()).toBe("사용 방법, 3단계 중 1단계. 알면 오른쪽으로 밀어요");
      expect(caption()).toHaveTextContent("알면 오른쪽으로 밀어요");
      // Presented by the mascot in its own face, 56 across, its line in the bubble beside it.
      const presenter = caption()?.querySelector('img[src*="/brand/knowno-"], svg.mascot');
      expect(presenter?.getAttribute("src") ?? presenter?.getAttribute("data-expression")).toMatch(
        /thinking/,
      );
      expect(presenter?.getAttribute("class")).toContain("size-14");
      expect(screen.getByTestId("coach-bubble")).toHaveTextContent("알면 오른쪽으로 밀어요");
      expect(screen.getByTestId("coach-bubble").className).toContain("bg-surface");
      // The hand, tilted, on its ring, with its trail drawn back to where it began.
      const touch = within(screen.getByTestId("coach-demo")).getByTestId("coach-touch");
      expect(touch).toBeVisible();
      expect(touch.querySelector('img[src="/brand/knowno-coach-hand.svg"]')).not.toBeNull();
      expect(within(touch).getByTestId("coach-trail").className).toContain("origin-right");
      // 이전 is off on the first step; there is no 건너뛰기.
      expect(screen.getByRole("button", { name: "이전" })).toBeDisabled();
      expect(screen.queryByRole("button", { name: "건너뛰기" })).not.toBeInTheDocument();
      // No control beside the caption: the answers and the replay wait for it to end.
      expect(answerButton("안다")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "안내 다시 보기" })).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "다음" }));
      expect(caption()).toHaveTextContent("모르면 왼쪽으로 밀어요");
      // 이전 returns a step, and 다음 leads on again.
      await user.click(screen.getByRole("button", { name: "이전" }));
      expect(caption()).toHaveTextContent("알면 오른쪽으로 밀어요");
      expect(announced()).toBe("사용 방법, 3단계 중 1단계. 알면 오른쪽으로 밀어요");
      await user.click(screen.getByRole("button", { name: "다음" }));
      expect(caption()).toHaveTextContent("모르면 왼쪽으로 밀어요");
      expect(within(screen.getByTestId("coach-demo")).getByTestId("coach-touch")).toBeVisible();
      expect(screen.getByTestId("coach-trail").className).toContain("origin-left");
      await user.click(screen.getByRole("button", { name: "다음" }));
      expect(caption()).toHaveTextContent(
        "응답한 카드는 위로 올라와요. 밀어서 응답을 바꿀 수 있어요",
      );
      expect(within(screen.getByTestId("coach-sample")).getByTestId("coach-touch")).toBeVisible();
      expect(screen.queryByRole("button", { name: /^마지막 응답 바꾸기/ })).not.toBeInTheDocument();
    });

    it("by touch draws no answer button, as the phone: 안내 다시 보기 alone, the answers and the change left to screen readers", async () => {
      window.localStorage.setItem("studyCoachShown", "true");
      byTouch();
      expect(window.matchMedia("(pointer: coarse)").matches).toBe(true);
      seedDeck(postgrest, "d1", ["un", "deux", "trois"]);
      await open("d1");

      expect(unseen(answerButton("모른다"))).toBe(true);
      expect(unseen(answerButton("안다"))).toBe(true);
      expect(unseen(screen.getByRole("button", { name: "안내 다시 보기" }))).toBe(false);
      // The current card's swipe answers, as on the phone.
      const current = screen.getByRole("region", { name: "현재 카드" });
      fireEvent.pointerDown(current, { pointerId: 1, pointerType: "touch", clientX: 100 });
      fireEvent.pointerMove(current, { pointerId: 1, pointerType: "touch", clientX: 260 });
      fireEvent.pointerUp(current, { pointerId: 1, pointerType: "touch", clientX: 260 });
      expect(shown()).toEqual([expect.stringMatching(/^방금 본 카드, 안다\. /)]);
      expect(unseen(screen.getByRole("button", { name: /^마지막 응답 바꾸기/ }))).toBe(true);
      // A screen reader still answers by the buttons it reaches.
      await userEvent.setup().click(answerButton("모른다") ?? document.body);
      expect(shown()).toEqual([expect.stringMatching(/^방금 본 카드, 모른다\. /)]);
    });

    it("with a pointer draws the answer buttons and 마지막 응답 바꾸기 with their keys", async () => {
      window.localStorage.setItem("studyCoachShown", "true");
      expect(typeof window.matchMedia).not.toBe("function");
      seedDeck(postgrest, "d1", ["un", "deux"]);
      await open("d1");
      const user = userEvent.setup();

      expect(answerButton("모른다")).toHaveTextContent("모른다 ←");
      expect(answerButton("안다")).toHaveTextContent("안다 →");
      expect(unseen(answerButton("모른다"))).toBe(false);
      expect(unseen(answerButton("안다"))).toBe(false);
      await user.click(answerButton("안다") ?? document.body);
      const change = screen.getByRole("button", { name: /^마지막 응답 바꾸기/ });
      expect(change).toHaveTextContent("마지막 응답 바꾸기 Z");
      expect(unseen(change)).toBe(false);
      expect(highlighted(change)).toBe(false);
    });

    it("with a pointer, on a device's first session, marks 안다 with →, then 모른다 with ←, then 마지막 응답 바꾸기 with Z, under a caption and with no finger, kept as shown once it shows", async () => {
      expect(typeof window.matchMedia).not.toBe("function");
      seedDeck(postgrest, "d1", ["un", "deux"]);
      await open("d1");
      // The coach starts once the screen has mounted.
      await screen.findByRole("region", { name: "학습 사용 방법" });
      const user = userEvent.setup();
      const change = () => screen.queryByRole("button", { name: /^마지막 응답 바꾸기/ });

      expect(caption()).toBeInTheDocument();
      // The flag is written by an effect after the render that shows the coach, so it is waited on.
      await waitFor(() => {
        expect(window.localStorage.getItem("studyCoachShown")).toBe("true");
      });
      expect(announced()).toBe("사용 방법, 3단계 중 1단계. 알면 안다(→)를 눌러요");
      expect(caption()).toHaveTextContent("알면 안다(→)를 눌러요");
      // The control the step names, with its key, marked under the caption; the other not.
      expect(answerButton("안다")).toHaveTextContent("안다 →");
      expect(highlighted(answerButton("안다"))).toBe(true);
      expect(highlighted(answerButton("모른다"))).toBe(false);
      expect(caption()?.compareDocumentPosition(answerButton("안다") ?? document.body)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      // The current card moves toward 안다 over its tint, with no finger and no drag.
      const demo = screen.getByTestId("coach-demo");
      expect(demo).toHaveAttribute("data-answer", "know");
      expect(demo).toContainElement(screen.getByRole("region", { name: "현재 카드" }));
      expect(screen.queryByTestId("coach-touch")).not.toBeInTheDocument();
      // What is above it steps back.
      const place = screen.getByRole("region", { name: "응답한 카드가 여기에 쌓여요" });
      expect(place.parentElement?.className).toContain("opacity-45");
      expect(change()).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "다음" }));
      expect(announced()).toBe("사용 방법, 3단계 중 2단계. 모르면 모른다(←)를 눌러요");
      expect(caption()).toHaveTextContent("모르면 모른다(←)를 눌러요");
      expect(screen.getByTestId("coach-demo")).toHaveAttribute("data-answer", "dontKnow");
      expect(answerButton("모른다")).toHaveTextContent("모른다 ←");
      expect(highlighted(answerButton("모른다"))).toBe(true);
      expect(highlighted(answerButton("안다"))).toBe(false);
      expect(screen.queryByTestId("coach-touch")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "다음" }));
      expect(announced()).toBe(
        "사용 방법, 3단계 중 3단계. 응답한 카드는 위로 올라와요. '마지막 응답 바꾸기'나 Z로 응답을 바꿀 수 있어요",
      );
      expect(caption()).toHaveTextContent(
        "응답한 카드는 위로 올라와요. '마지막 응답 바꾸기'나 Z로 응답을 바꿀 수 있어요",
      );
      // 마지막 응답 바꾸기 with Z shows before any answer, marked; the answers are not.
      expect(change()).toHaveTextContent("마지막 응답 바꾸기 Z");
      expect(highlighted(change())).toBe(true);
      expect(highlighted(answerButton("안다"))).toBe(false);
      expect(highlighted(answerButton("모른다"))).toBe(false);
      // A sample answered card in the previous card's place, changing toward 모른다.
      const sample = screen.getByTestId("coach-sample");
      expect(sample).toHaveTextContent("deadline");
      expect(sample).toHaveTextContent("모른다로 바꿔요");
      expect(screen.queryByTestId("coach-touch")).not.toBeInTheDocument();
      // A previous card, so graded by its fill and line alone, with no chip.
      expect(within(sample).queryByText("안다")).not.toBeInTheDocument();
      expect(screen.queryByTestId("coach-demo")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("region", { name: "응답한 카드가 여기에 쌓여요" }),
      ).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "시작하기" }));
      expect(caption()).not.toBeInTheDocument();
      expect(screen.queryByTestId("coach-sample")).not.toBeInTheDocument();
      expect(answerButton("안다")).toBeInTheDocument();
      expect(highlighted(answerButton("안다"))).toBe(false);
      // With nothing answered, 마지막 응답 바꾸기 goes with the coach.
      expect(change()).not.toBeInTheDocument();
      expect(
        screen.getByRole("region", { name: "응답한 카드가 여기에 쌓여요" }),
      ).toBeInTheDocument();
      cleanup();

      // A later session in the same browser shows none, after the moment the coach would start.
      await open("d1");
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
      expect(caption()).not.toBeInTheDocument();
      expect(answerButton("안다")).toBeInTheDocument();
    });

    it("ends on 시작하기 and on an answer, not on a change of the previous card, and the mascot goes with it; 안내 다시 보기 shows it again", async () => {
      seedDeck(postgrest, "d1", ["un", "deux", "trois"]);
      await open("d1");
      // The coach starts once the screen has mounted.
      await screen.findByRole("region", { name: "학습 사용 방법" });
      const user = userEvent.setup();
      const mascots = () => document.querySelectorAll('img[src*="/brand/knowno-"], svg.mascot');
      expect(mascots()).toHaveLength(1);

      for (const step of ["다음", "다음", "시작하기"]) {
        await user.click(screen.getByRole("button", { name: step }));
      }
      expect(caption()).not.toBeInTheDocument();
      expect(mascots()).toHaveLength(0);
      expect(answerButton("안다")).toBeInTheDocument();

      // An answer by its key, with the coach skipped, gives a previous card.
      await user.keyboard("{ArrowRight}");
      expect(shown()).toHaveLength(1);

      await user.click(screen.getByRole("button", { name: "안내 다시 보기" }));
      expect(announced()).toContain("3단계 중 1단계");
      // Changing the previous card leaves it running.
      await user.keyboard("z");
      expect(shown()).toEqual([expect.stringMatching(/^방금 본 카드, 모른다\. .*\. 수정됨$/)]);
      expect(announced()).toContain("3단계 중 1단계");
      // An answer by its key ends it.
      await user.keyboard("{ArrowRight}");
      expect(caption()).not.toBeInTheDocument();
    });

    /** The classes of whatever moves in [testId]'s demonstration. */
    const moving = (testId: string) =>
      [...screen.getByTestId(testId).querySelectorAll("[class*=animate-coach]")]
        .map((element) => element.getAttribute("class") ?? "")
        .join(" ");
    const steps = [
      ["coach-demo", "know", "안다"],
      ["coach-demo", "dont-know", "모른다"],
      ["coach-sample", "change", "마지막 응답 바꾸기"],
    ] as const;

    it("by touch, under reduce motion holds each step still where the card is out under its hand and trail, and shows the mascot and bubble at once, and moves them otherwise", async () => {
      byTouch();
      expect(window.matchMedia("(pointer: coarse)").matches).toBe(true);
      seedDeck(postgrest, "d1", ["un", "deux"]);
      await open("d1");
      // The coach starts once the screen has mounted.
      await screen.findByRole("region", { name: "학습 사용 방법" });
      const user = userEvent.setup();
      // The mascot and the bubble rise in only where motion is not reduced.
      const rise = caption()?.className.split(" ") ?? [];
      expect(rise).toContain("motion-safe:starting:opacity-0");
      expect(rise).toContain("motion-safe:starting:translate-y-4");
      expect(rise.filter((name) => /^(starting:|transition|translate|opacity)/.test(name))).toEqual(
        [],
      );

      for (const [testId, name] of steps) {
        const classes = moving(testId);
        expect(classes).toContain(`motion-safe:animate-coach-${name} `);
        expect(classes).toContain(`motion-reduce:animate-coach-${name}-held`);
        expect(classes).toContain("motion-reduce:animate-coach-touch-held");
        expect(classes).toContain("motion-safe:animate-coach-trail ");
        expect(classes).toContain("motion-reduce:animate-coach-trail-held");
        await user.click(screen.getByRole("button", { name: /^(다음|시작하기)$/ }));
      }
    });

    it("with a pointer, under reduce motion holds the mark on its control and the card out, and presses the control before the card moves otherwise", async () => {
      expect(typeof window.matchMedia).not.toBe("function");
      seedDeck(postgrest, "d1", ["un", "deux"]);
      await open("d1");
      // The coach starts once the screen has mounted.
      await screen.findByRole("region", { name: "학습 사용 방법" });
      const user = userEvent.setup();

      for (const [testId, name, control] of steps) {
        const classes = moving(testId);
        expect(classes).toContain(`motion-safe:animate-coach-${name} `);
        expect(classes).toContain(`motion-reduce:animate-coach-${name}-held`);
        expect(classes).not.toContain("coach-touch");
        // The ring is not an animation, so it holds under reduce motion; the press moves alone.
        const marked = screen.getByRole("button", { name: new RegExp(`^${control}`) }).className;
        expect(marked).toContain("outline-hero");
        expect(marked).toContain("motion-safe:animate-coach-press");
        expect(marked).not.toContain("motion-reduce:animate");
        await user.click(screen.getByRole("button", { name: /^(다음|시작하기)$/ }));
      }
    });
  });

  it("on a reopened day shows the day's last card from an earlier session, graded and labelled, opened by a click and not changed by a swipe, until the first answer", async () => {
    seedDeck(postgrest, "d1", ["un", "deux", "trois"]);
    for (const [index, front] of ["un", "deux"].entries()) {
      postgrest.seed(
        "card_states",
        stateRow(`d1-${String(index)}`, {
          stability: 1,
          difficulty: 5,
          lastReview: start - hour,
          due: start + day,
        }),
      );
      postgrest.seed(
        "reviews",
        reviewRow(`r-${front}`, `d1-${String(index)}`, start - hour + index * 1_000, 1_000),
      );
    }
    await open("d1");

    const label = "지난번 마지막 카드. 앞면: deux. 뒷면: deux back. 응답: 안다";
    expect(shown()).toEqual([label]);
    const card = within(cards()).getByRole("article");
    expect(within(card).getByText("지난번 마지막 카드")).toBeInTheDocument();
    // Graded by its line alone, as the previous card is.
    expect(within(card).queryByText("안다")).not.toBeInTheDocument();
    expect(
      within(card).getByRole("button", { name: "카드 전체 보기" }).querySelector(".border-3")
        ?.className,
    ).toContain("border-know");
    expect(
      screen.queryByRole("region", { name: "응답한 카드가 여기에 쌓여요" }),
    ).not.toBeInTheDocument();

    // A touch swipe toward 모른다 shows nothing behind it and changes nothing.
    fireEvent.pointerDown(card, { pointerId: 1, pointerType: "touch", clientX: 200, clientY: 100 });
    fireEvent.pointerMove(card, { pointerId: 1, pointerType: "touch", clientX: 40, clientY: 100 });
    expect(within(card).queryByText("모른다로 바꿔요")).not.toBeInTheDocument();
    fireEvent.pointerUp(card, { pointerId: 1, pointerType: "touch", clientX: 40, clientY: 100 });
    expect(shown()).toEqual([label]);
    expect(postgrest.rows.reviews.map((row) => row.rating)).toEqual(["good", "good"]);

    // A click opens it whole.
    const user = userEvent.setup();
    await user.click(within(card).getByRole("button", { name: "카드 전체 보기" }));
    const detail = screen.getByRole("dialog", { name: "카드" });
    expect(within(detail).getByText("deux back")).toBeInTheDocument();
    await user.keyboard("{Escape}");

    // The first answer takes its place.
    await user.keyboard("{ArrowRight}");
    expect(screen.queryByText("지난번 마지막 카드")).not.toBeInTheDocument();
    expect(shown()).toEqual([expect.stringMatching(/^방금 본 카드, 안다\. 앞면: trois\. /)]);
  });

  it("shows a vocabulary card's senses once answered, on the previous card and in its dialog, each label in brackets with a gap after it", async () => {
    postgrest.seed("decks", deckRow("d1", "d1"));
    postgrest.seed("cards", {
      ...cardRow("d1-0", "d1", "train"),
      back: [
        {
          type: "senses",
          payload: {
            senses: [
              {
                labels: [{ kind: "part_of_speech", category: "noun", text: "명" }],
                meaning: "기차",
                examples: [],
              },
              {
                labels: [{ kind: "other", category: null, text: "구어" }],
                meaning: "열차",
                examples: [],
              },
            ],
          },
        },
      ],
    });
    await open("d1");
    const user = userEvent.setup();
    await user.keyboard("{ArrowRight}");

    const card = within(cards()).getByRole("article");
    const drawn = [
      { labels: ["[명]"], gapped: true, text: "[명]기차" },
      { labels: ["[구어]"], gapped: true, text: "[구어]열차" },
    ];
    expect(sensesUnder(card)).toEqual(drawn);
    expect(shown()).toEqual(["방금 본 카드, 안다. 앞면: train. 뒷면: [명] 기차\n[구어] 열차"]);
    await user.click(within(card).getByRole("button", { name: "카드 전체 보기" }));
    expect(sensesUnder(screen.getByRole("dialog", { name: "카드" }))).toEqual(drawn);
  });

  describe("a card's sound (ADR 0112)", () => {
    const signPath = `${supabaseUrl}/storage/v1/object/sign/media`;
    /** The paths each signing request asked for. */
    let signed: string[][];
    /** The address each play started from. */
    let played: string[];
    /** The address each pause was asked of. */
    let paused: string[];

    beforeEach(() => {
      signed = [];
      played = [];
      paused = [];
      vi.spyOn(window.HTMLMediaElement.prototype, "pause").mockImplementation(function (
        this: HTMLMediaElement,
      ) {
        paused.push(this.src);
      });
      vi.spyOn(window.HTMLMediaElement.prototype, "play").mockImplementation(function (
        this: HTMLMediaElement,
      ) {
        played.push(this.src);
        return Promise.resolve();
      });
      postgrest.seed("decks", deckRow("d1", "d1"));
      postgrest.seed("cards", {
        ...cardRow("d1-0", "d1", "meow"),
        front: [
          { type: "text", payload: { text: "meow" } },
          { type: "audio", v: 1, payload: { media: "m1", duration_ms: 1250 } },
        ],
        back: [
          { type: "text", payload: { text: "cat" } },
          { type: "audio", v: 1, payload: { media: "m2", duration_ms: 3000 } },
        ],
      });
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    /** Storage signing each path asked for, as `createSignedUrls` reads its answer. */
    function signEach() {
      server.use(
        http.post(signPath, async ({ request }) => {
          const { paths } = (await request.json()) as { paths: string[] };
          signed.push(paths);
          return HttpResponse.json(
            paths.map((path) => ({
              path,
              signedURL: `/object/sign/media/${path}?token=t`,
              error: null,
            })),
          );
        }),
      );
    }

    it("signs the user's sounds once, plays nothing on its own, and plays the front's from 소리 듣기, then the back's from the opened card", async () => {
      signEach();
      await open("d1");

      expect(signed).toEqual([[`${testUser.id}/m1`, `${testUser.id}/m2`]]);
      expect(played).toEqual([]);
      const current = screen.getByRole("region", { name: "현재 카드" });
      expect(within(current).getByText("0:02")).toBeInTheDocument();
      const user = userEvent.setup();
      await user.click(within(current).getByRole("button", { name: "소리 듣기" }));
      expect(played).toEqual([`${signPath}/${testUser.id}/m1?token=t`]);

      await user.keyboard("{ArrowRight}");
      await user.click(within(cards()).getByRole("button", { name: "카드 전체 보기" }));
      const detail = screen.getByRole("dialog", { name: "카드" });
      const controls = within(detail).getAllByRole("button", { name: "소리 듣기" });
      expect(controls).toHaveLength(2);
      await user.click(controls[1] as HTMLElement);
      expect(played.at(-1)).toBe(`${signPath}/${testUser.id}/m2?token=t`);
    });

    it("says a sound cannot play when Storage signs none, where a signed one plays", async () => {
      server.use(http.post(signPath, () => HttpResponse.json({ error: "down" }, { status: 500 })));
      await open("d1");
      const user = userEvent.setup();
      const current = screen.getByRole("region", { name: "현재 카드" });

      await user.click(within(current).getByRole("button", { name: "소리 듣기" }));

      expect(played).toEqual([]);
      expect(within(current).getByText("소리를 재생하지 못했어요")).toBeInTheDocument();
    });

    it("pauses a sound still playing when its card leaves", async () => {
      signEach();
      await open("d1");
      const user = userEvent.setup();
      const current = screen.getByRole("region", { name: "현재 카드" });
      await user.click(within(current).getByRole("button", { name: "소리 듣기" }));
      expect(played).toEqual([`${signPath}/${testUser.id}/m1?token=t`]);
      expect(paused, "setup: still on the card").toEqual([]);

      await user.keyboard("{ArrowRight}");
      // The answered card stacks up, so the answer has been taken.
      await within(cards()).findByRole("button", { name: "카드 전체 보기" });

      expect(paused).toEqual([`${signPath}/${testUser.id}/m1?token=t`]);
    });
  });

  describe("a card of 칸", () => {
    /** Answers the card on screen "안다" and waits for its write, which no later test may meet. */
    async function answerKnow() {
      await userEvent.setup().keyboard("{ArrowRight}");
      await waitFor(() => {
        expect(postgrest.rows.card_states).toHaveLength(1);
      });
    }

    it("has a drawing for every fixture placement", () => {
      expect(Object.keys(drawn).sort()).toEqual(placements.map(({ name }) => name).sort());
    });

    describe.each([
      {
        form: "stored as two sides",
        row: ({ front, back }: (typeof placements)[number]) => ({ front, back }),
      },
      {
        form: "stored as a free v2 list",
        row: ({ cells }: (typeof placements)[number]) => ({
          front: cells,
          back: [],
          template: "free",
          template_version: 2,
        }),
      },
    ])("$form", ({ row }) => {
      it.each(placements)("draws before and after the answer: $name", async (placement) => {
        const expected = drawn[placement.name];
        if (!expected) throw new Error("no drawing for this placement");
        postgrest.seed("decks", deckRow("d1", "d1"));
        postgrest.seed("cards", { ...cardRow("d1-0", "d1", "card"), ...row(placement) });
        await open("d1");

        const front = screen.getByRole("group", { name: "앞면" });
        const whole = within(front).queryByRole("group");
        expect(whole !== null).toBe(expected.whole);
        expect(whole?.getAttribute("aria-label") ?? front.textContent).toBe(expected.before);
        if (whole) expect(Object.values(blanksUnder(whole))).not.toContain(true);
        // A split side draws its photo whole; a whole card draws it in its frame.
        if (!whole) expect(front.querySelector("[data-image]") !== null).toBe(!!expected.photo);

        await answerKnow();

        const previous = within(cards()).getByRole("article");
        expect(within(previous).getByRole("button").textContent).toBe(expected.after);
        expect(Object.values(blanksUnder(previous))).not.toContain(false);
      });
    });

    it("studies a card whose blank sat on its back alone on one card, its answer hidden until answered (#482)", async () => {
      postgrest.seed("decks", deckRow("d1", "d1"));
      postgrest.seed("cards", {
        ...cardRow("d1-0", "d1", "card"),
        front: side("Fill it"),
        back: [{ type: "cloze", payload: { text: "___ is red.", answers: ["Rose"] } }],
      });
      await open("d1");

      const current = screen.getByRole("group", { name: "Fill it. 빈칸 is red." });
      expect(blanksUnder(current)).toEqual({ Rose: false });

      await answerKnow();

      expect(shown()).toEqual([
        "방금 본 카드, 안다. 앞면: Fill it. 빈칸 is red.. 뒷면: Fill it. Rose is red.",
      ]);
      expect(blanksUnder(within(cards()).getByRole("article"))).toEqual({ Rose: true });
    });

    it("keeps a card holding a block this build does not know, its sides as stored", async () => {
      postgrest.seed("decks", deckRow("d1", "d1"));
      postgrest.seed("cards", {
        ...cardRow("d1-0", "d1", "card"),
        front: side("before"),
        back: [{ type: "chart", payload: {} }],
      });
      await open("d1");
      expect(currentFront()).toBe("before");

      await answerKnow();
      expect(within(within(cards()).getByRole("article")).getByRole("button").textContent).toBe(
        "before[이 버전에서 표시할 수 없는 내용: chart]",
      );
    });
  });

  describe("a whole card", () => {
    // Stored as the phone stores them: typed blocks, the back their filled text.
    const cloze = {
      front: [
        { type: "cloze", payload: { text: "The capital of France is ___", answers: ["Paris"] } },
      ],
      back: "The capital of France is Paris",
    };
    const table = {
      front: [
        { type: "text", payload: { text: "Capitals" } },
        {
          type: "table",
          payload: {
            columns: ["Capital", "Country"],
            rows: [
              ["Paris", "France"],
              ["Berlin", "Germany"],
            ],
            blanks: [
              { row: 0, column: 0 },
              { row: 1, column: 0 },
            ],
          },
        },
      ],
      back: "Capitals\nCapital | Country\nParis | France\nBerlin | Germany",
    };

    /** Seeds deck d1 with one card of [card]'s blocks and back. */
    function seedWhole(card: { front: unknown[]; back: string }) {
      postgrest.seed("decks", deckRow("d1", "d1"));
      postgrest.seed("cards", {
        ...cardRow("d1-0", "d1", "whole"),
        front: card.front,
        back: side(card.back),
      });
    }

    it("shows a cloze card's sentence with its blank empty, and once answered, as one card, fills it in place on the previous card and in its dialog", async () => {
      seedWhole(cloze);
      await open("d1");
      const current = screen.getByRole("group", { name: "The capital of France is 빈칸" });
      expect(blanksUnder(current)).toEqual({ Paris: false });
      expect(screen.getByText("0/1")).toBeInTheDocument();

      const user = userEvent.setup();
      await user.keyboard("{ArrowRight}");

      expect(screen.getByText("1/1")).toBeInTheDocument();
      expect(shown()).toEqual([
        "방금 본 카드, 안다. 앞면: The capital of France is 빈칸. 뒷면: The capital of France is Paris",
      ]);
      const card = within(cards()).getByRole("article");
      expect(blanksUnder(card)).toEqual({ Paris: true });
      await user.click(within(card).getByRole("button", { name: "카드 전체 보기" }));
      const detail = screen.getByRole("dialog", { name: "카드" });
      expect(blanksUnder(detail)).toEqual({ Paris: true });
      expect(within(detail).queryByText("뒷면")).not.toBeInTheDocument();
    });

    it("shows a table card whole with its headers and its cells to recall empty, and once answered, as one card, fills every one", async () => {
      seedWhole(table);
      await open("d1");
      const current = screen.getByRole("group", {
        name: "Capitals. Capital, Country. 빈칸, France. 빈칸, Germany",
      });
      for (const header of ["Capital", "Country", "France", "Germany"]) {
        expect(within(current).getByText(header)).toBeInTheDocument();
      }
      expect(blanksUnder(current)).toEqual({ Paris: false, Berlin: false });

      await userEvent.setup().keyboard("{ArrowRight}");

      expect(screen.getByText("1/1")).toBeInTheDocument();
      expect(blanksUnder(within(cards()).getByRole("article"))).toEqual({
        Paris: true,
        Berlin: true,
      });
    });
  });

  describe("the day's last card from an earlier session", () => {
    /** Stores an answer of 안다 to [cardId] at [at], with its state due tomorrow. */
    function answered(postgrest: FakePostgrest, cardId: string, at: number) {
      postgrest.seed(
        "card_states",
        stateRow(cardId, { stability: 1, difficulty: 5, lastReview: at, due: start + day }),
      );
      postgrest.seed("reviews", reviewRow(`r-${cardId}`, cardId, at, 1_000));
    }
    /** The front of the earlier card the page shows, or null. */
    const earlierFront = () =>
      /^지난번 마지막 카드\. 앞면: ([^.]*)\./.exec(shown()[0] ?? "")?.[1] ?? null;

    it("is the last answer to a card still in the deck, not one to a card deleted since", async () => {
      seedDeck(postgrest, "d1", ["un", "deux", "trois"]);
      answered(postgrest, "d1-0", start - 2 * hour);
      answered(postgrest, "d1-1", start - hour);
      // Control: with deux in the deck, its answer is the last.
      await open("d1");
      expect(earlierFront()).toBe("deux");
      cleanup();

      const deux = postgrest.rows.cards.find((row) => row.id === uuidOf("d1-1"));
      if (!deux) throw new Error("deux is seeded above");
      deux.deleted_at = new Date(start - hour / 2).toISOString();
      await open("d1");
      expect(earlierFront()).toBe("un");
    });

    it("is the last answer within the decks studied, not a later one in another deck", async () => {
      seedDeck(postgrest, "d1", ["un", "deux"]);
      seedDeck(postgrest, "d2", ["zwei"]);
      answered(postgrest, "d1-0", start - 2 * hour);
      answered(postgrest, "d2-0", start - hour);
      await open("d1");
      expect(earlierFront()).toBe("un");
      cleanup();

      // Control: over both decks, the other deck's later answer is the last.
      await open("d1,d2");
      expect(earlierFront()).toBe("zwei");
    });

    it("is an answer from 04:00 today, not one at 03:59, the day before", async () => {
      // With no zone cookie, the day is read in the fallback zone.
      const dayStart = studyDayStart(start, "Asia/Seoul");
      seedDeck(postgrest, "d1", ["un", "deux", "trois"]);
      answered(postgrest, "d1-0", dayStart - 60_000);
      await open("d1");
      expect(earlierFront()).toBeNull();
      expect(
        screen.getByRole("region", { name: "응답한 카드가 여기에 쌓여요" }),
      ).toBeInTheDocument();
      cleanup();

      // Control: at 04:00 the answer is the day's.
      answered(postgrest, "d1-1", dayStart);
      await open("d1");
      expect(earlierFront()).toBe("deux");
    });
  });
});

describe("the study page when its decks cannot be read", () => {
  beforeEach(async () => {
    setRequestCookies(await signedInCookies());
  });

  it("says so and offers 그만하기 back to 오늘, since no shell surrounds the page", async () => {
    const postgrest = new FakePostgrest();
    postgrest.studySettings.set(testUser.id, fiveMinutes);
    server.use(...postgrest.handlers);
    postgrest.fail("decks", 500);
    vi.setSystemTime(start);

    await render(Study, { searchParams: Promise.resolve({ decks: uuidOf("d1") }) });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "서버에 연결할 수 없어요. 연결을 확인하고 다시 시도해 주세요.",
    );
    expect(screen.getByRole("link", { name: "그만하기" })).toHaveAttribute("href", "/");
  });
});
