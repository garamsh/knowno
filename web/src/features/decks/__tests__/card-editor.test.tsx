import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { cardRow, deckRow, uuidOf } from "@/testing/library";
import { FakePostgrest } from "@/testing/mocks/postgrest";
import { server } from "@/testing/mocks/server";
import { setRequestCookies } from "@/testing/next-headers";
import { addByHand } from "@/testing/add-by-hand";
import { render } from "@/testing/render";
import { signedInCookies } from "@/testing/session";

import { parseCardContent } from "../card-content";
import { NoteSettings } from "../components/note-settings";
import { CardEditor } from "../components/card-editor";
import { parseDeckId, parseCardId, type Card } from "../library";

vi.mock("next/headers", () => import("@/testing/next-headers"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const deckId = parseDeckId(uuidOf("deck"));
const cardId = parseCardId(uuidOf("card"));
if (!deckId || !cardId) throw new Error("fixture ids");
const deck = { id: deckId, name: "단어장", public: false };
let db: FakePostgrest;
beforeEach(async () => {
  db = new FakePostgrest();
  server.use(...db.handlers);
  setRequestCookies(await signedInCookies());
  db.rows.decks.push(deckRow("deck", "단어장"));
});

/** Opens direct entry from the deck's "카드 추가". */
async function newCard() {
  await render(() => <NoteSettings deck={deck} cardCount={0} displayName={{ name: null }} />, {});
  await addByHand();
  await userEvent.click(screen.getByRole("button", { name: "직접 입력" }));
}

/** A stored card of [front] and [back] as the deck page hands it to the editor. */
function storedCard(front: unknown, back: unknown, template = "free", templateVersion = 1): Card {
  const content = parseCardContent({ front, back, template, templateVersion });
  if (!content) throw new Error("a fixture did not parse");
  return { id: cardId as never, deckId: deckId as never, createdAt: 0, ...content };
}

/** The editor over a stored [card], which [db] holds. */
async function editing(front: unknown, back: unknown, template = "free", version = 1) {
  db.rows.cards.push({
    ...cardRow("card", "deck", "old"),
    front,
    back,
    template,
    template_version: version,
  });
  const close = vi.fn();
  await render(
    () => (
      <CardEditor deck={deck} card={storedCard(front, back, template, version)} close={close} />
    ),
    {},
  );
  return close;
}

const add = async (name: string) => {
  await userEvent.click(screen.getByRole("button", { name: "+ 칸 추가" }));
  await userEvent.click(
    within(screen.getByRole("dialog", { name: "칸 추가" })).getByRole("button", { name }),
  );
};
const removeFirst = async () => {
  await userEvent.click(screen.getByRole("button", { name: "1번째 칸 메뉴" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "삭제" }));
};
/** Selects [start] to [end] of [field], as a press and drag would. */
function select(field: HTMLElement, start: number, end: number) {
  if (!(field instanceof HTMLTextAreaElement)) throw new Error("not a line");
  field.focus();
  field.setSelectionRange(start, end);
  fireEvent.select(field);
}

describe("a new card", () => {
  it("opens with one 글, the focus in its 앞면", async () => {
    await newCard();
    expect(screen.getByRole("heading", { name: "글" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "앞면" })).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "뒷면" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "앞면" })).not.toBeInTheDocument();
  });

  it("offers 글, 단어, 빈칸 문장, 표, 사진 and 소리 under '+ 칸 추가', each its icon, name and line, as the phone's sheet", async () => {
    await newCard();
    await userEvent.click(screen.getByRole("button", { name: "+ 칸 추가" }));
    const sheet = screen.getByRole("dialog", { name: "칸 추가" });
    const [, ...rows] = within(sheet).getAllByRole("button");
    expect(
      rows.map((row) => [
        row.textContent,
        [...row.querySelectorAll("svg")].map((icon) => icon.getAttribute("class")?.split(" ")[1]),
      ]),
    ).toEqual([
      ["글앞면과 뒷면에 글을 적어요", ["lucide-type"]],
      ["단어단어와 뜻을 함께 적어요", ["lucide-book-a"]],
      ["빈칸 문장문장 속 단어를 가려요", ["lucide-text-cursor-input"]],
      ["표가릴 부분을 골라요", ["lucide-table"]],
      ["사진사진 위에 가릴 곳을 그려요", ["lucide-image"]],
      ["소리녹음하거나 파일을 넣어요", ["lucide-audio-lines"]],
    ]);
    await userEvent.click(within(sheet).getByRole("button", { name: "표" }));
    expect(screen.getByRole("heading", { name: "표" })).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "표 도구" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "1열 머리글" })).toHaveFocus();
  });

  it("saves a 글 as free v2 and starts the next card empty under 저장하고 다음 카드", async () => {
    await newCard();
    await userEvent.type(screen.getByRole("textbox", { name: "앞면" }), "apple");
    await userEvent.type(screen.getByRole("textbox", { name: "뒷면" }), "사과");
    await userEvent.click(screen.getByRole("button", { name: "저장하고 다음 카드" }));
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "앞면" })).toHaveValue("");
    });
    expect(db.rows.cards[0]).toMatchObject({
      template_version: 2,
      back: [],
      front: [{ type: "text", v: 2, payload: { front: "apple", back: "사과" } }],
    });
    expect(screen.getByRole("textbox", { name: "앞면" })).toHaveFocus();
    // A second card is one of its own, not the first saved again.
    await userEvent.type(screen.getByRole("textbox", { name: "앞면" }), "pear");
    await userEvent.type(screen.getByRole("textbox", { name: "뒷면" }), "배");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => {
      expect(db.rows.cards).toHaveLength(2);
    });
  });

  it("reads ADR 0137's two sentences under the column, and saves nothing", async () => {
    await newCard();
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByRole("alert")).toHaveTextContent("앞면에 보일 내용을 하나 이상 넣어 주세요");
    await userEvent.type(screen.getByRole("textbox", { name: "앞면" }), "front");
    expect(screen.getByRole("alert")).toHaveTextContent("뒷면이나 빈칸을 하나 이상 넣어 주세요");
    // Control: with a back it saves and the sentence goes.
    await userEvent.type(screen.getByRole("textbox", { name: "뒷면" }), "back");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(db.rows.cards).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => {
      expect(db.rows.cards).toHaveLength(1);
    });
  });

  it("writes a 단어 with its asked side, each meaning's row, and the phone's refusals", async () => {
    await newCard();
    await removeFirst();
    await add("단어");
    await userEvent.type(screen.getByRole("textbox", { name: "단어" }), "apple");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByRole("alert")).toHaveTextContent("내용을 적어 주세요");
    await userEvent.type(screen.getByRole("textbox", { name: "뜻" }), "사과");
    await userEvent.click(screen.getByRole("button", { name: "+ 뜻 추가" }));
    expect(screen.getByRole("alert")).toHaveTextContent("뜻을 적어 주세요");
    await userEvent.type(screen.getByRole("textbox", { name: "뜻 2" }), "능금");
    const asked = screen.getByRole("group", { name: "앞면에 보일 것" });
    expect(within(asked).getByRole("button", { name: "단어" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await userEvent.click(within(asked).getByRole("button", { name: "뜻" }));
    await userEvent.click(screen.getByRole("button", { name: "2번째 뜻 메뉴" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "위로" }));
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => {
      expect(db.rows.cards).toHaveLength(1);
    });
    expect(db.rows.cards[0]).toMatchObject({
      card_key: "능금 사과",
      front: [
        {
          type: "senses",
          payload: {
            term: "apple",
            ask: "meaning",
            senses: [{ meaning: "능금" }, { meaning: "사과" }],
          },
        },
      ],
    });
  });

  it("focuses a new 사진 or 소리 칸's pick, as a new 글 its 앞면", async () => {
    await newCard();
    await add("사진");
    expect(screen.getByLabelText("앨범에서 고르기")).toHaveFocus();
    await add("소리");
    expect(screen.getByLabelText("파일에서 고르기")).toHaveFocus();
    // Control: a new 글 takes its 앞면's focus.
    await add("글");
    expect(screen.getAllByRole("textbox", { name: "앞면" }).at(-1)).toHaveFocus();
  });

  it("shows a refused save's problem and focuses the field of the 칸 it is in", async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    try {
      await newCard();
      await removeFirst();
      await add("글");
      await add("단어");
      await userEvent.type(screen.getByRole("textbox", { name: "앞면" }), "front");
      await userEvent.type(screen.getByRole("textbox", { name: "뒷면" }), "back");
      await userEvent.type(screen.getByRole("textbox", { name: "단어" }), "apple");
      // The adds scroll their fields into view; only the save's scroll counts.
      scrolled.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "저장" }));
      expect(screen.getByRole("alert")).toHaveTextContent("내용을 적어 주세요");
      expect(scrolled.mock.contexts).toEqual([screen.getByRole("alert")]);
      expect(screen.getByRole("textbox", { name: "단어" })).toHaveFocus();
      // A second refusal reveals it again.
      await userEvent.click(screen.getByRole("textbox", { name: "앞면" }));
      scrolled.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "저장" }));
      expect(scrolled.mock.contexts).toEqual([screen.getByRole("alert")]);
      expect(screen.getByRole("textbox", { name: "단어" })).toHaveFocus();
      expect(db.rows.cards).toHaveLength(0);
    } finally {
      Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    }
  });

  it("makes a selection a blank through the line's one action, and turns it back", async () => {
    await newCard();
    await removeFirst();
    await add("빈칸 문장");
    const line = screen.getByRole("textbox", { name: "문장" });
    await userEvent.type(line, "Rose is red");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByRole("alert")).toHaveTextContent("빈칸을 하나 이상 넣어 주세요");
    select(line, 0, 4);
    await userEvent.click(screen.getByRole("button", { name: "빈칸 넣기" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    select(line, 2, 2);
    expect(screen.getByRole("button", { name: "빈칸 풀기, Rose" })).toHaveTextContent("빈칸 풀기");
    await userEvent.click(screen.getByRole("button", { name: "빈칸 풀기, Rose" }));
    expect(screen.getByRole("alert")).toHaveTextContent("빈칸을 하나 이상 넣어 주세요");
    select(line, 8, 11);
    await userEvent.click(screen.getByRole("button", { name: "빈칸 넣기" }));
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => {
      expect(db.rows.cards).toHaveLength(1);
    });
    expect(db.rows.cards[0]?.front).toMatchObject([
      { type: "cloze", v: 1, payload: { text: "Rose is ___", answers: ["red"] } },
    ]);
  });

  it("tints a blank's words in the line, and draws an empty blank as an underline where the caret stands", async () => {
    await newCard();
    await removeFirst();
    await add("빈칸 문장");
    const line = screen.getByRole("textbox", { name: "문장" });
    // The copy under the line that draws its marks; the line's own text is transparent over it.
    const copy = line.previousElementSibling;
    if (!(copy instanceof HTMLElement)) throw new Error("the line's marks are not drawn");
    await userEvent.type(line, "Rose is red");
    expect(within(copy).queryByText("Rose"), "control: no mark before a blank").toBeNull();
    select(line, 0, 4);
    await userEvent.click(screen.getByRole("button", { name: "빈칸 넣기" }));
    expect(within(copy).getByText("Rose")).toHaveClass("bg-brand-tint");
    expect(copy.querySelector(".bg-muted"), "control: no empty blank yet").toBeNull();
    select(line, 11, 11);
    await userEvent.click(screen.getByRole("button", { name: "빈칸 넣기" }));
    expect(copy.querySelector(".bg-muted")).toHaveClass("absolute", "bottom-0", "h-px", "w-8");
  });

  it("types an opened blank's answer, and drops one left empty", async () => {
    await newCard();
    await removeFirst();
    await add("빈칸 문장");
    const line = screen.getByRole("textbox", { name: "문장" });
    await userEvent.type(line, "is red");
    select(line, 0, 0);
    await userEvent.click(screen.getByRole("button", { name: "빈칸 넣기" }));
    await userEvent.keyboard("Rose");
    select(line, 9, 9);
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => {
      expect(db.rows.cards).toHaveLength(1);
    });
    expect(db.rows.cards[0]?.front).toMatchObject([
      { payload: { text: "___is red", answers: ["Rose"] } },
    ]);
  });

  it("keeps the line's action under a press elsewhere until it ends, so the control pressed stays put", async () => {
    await newCard();
    await removeFirst();
    await add("빈칸 문장");
    await userEvent.click(screen.getByRole("textbox", { name: "문장" }));
    const more = screen.getByRole("button", { name: "+ 칸 추가" });
    // One session, so the release ends the press begun by the first call.
    const user = userEvent.setup();
    await user.pointer({ keys: "[MouseLeft>]", target: more });
    expect(more).toHaveFocus();
    expect(screen.getByRole("button", { name: "빈칸 넣기" })).toBeInTheDocument();
    await user.pointer({ keys: "[/MouseLeft]", target: more });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "빈칸 넣기" })).not.toBeInTheDocument();
    });
    // The press was a click on the control it started on.
    expect(screen.getByRole("dialog", { name: "칸 추가" })).toBeInTheDocument();
  });

  it("makes a table's cell a blank from the phone's fixed toolbar, and deletes a row at once", async () => {
    await newCard();
    await removeFirst();
    await add("표");
    const toolbar = screen.getByRole("toolbar", { name: "표 도구" });
    const tools = () =>
      within(toolbar)
        .getAllByRole("button")
        .map((tool) => [tool.textContent, tool.hasAttribute("disabled")]);
    // Every tool is drawn with the focus in a header, as the 칸 opens: "빈칸" off, as for no cell.
    expect(screen.getByRole("textbox", { name: "1열 머리글" })).toHaveFocus();
    expect(tools()).toEqual([
      ["행 추가", false],
      ["열 추가", false],
      ["빈칸", true],
      ["삭제", false],
    ]);
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByRole("alert")).toHaveTextContent("빈칸으로 할 칸을 하나 이상 골라 주세요");
    const cell = screen.getByRole("textbox", { name: "1행 2열" });
    select(cell, 0, 0);
    expect(tools()).toEqual([
      ["행 추가", false],
      ["열 추가", false],
      ["빈칸", false],
      ["삭제", false],
    ]);
    await userEvent.click(screen.getByRole("button", { name: "빈칸" }));
    expect(screen.getByRole("alert")).toHaveTextContent("빈칸으로 고른 칸에 내용을 적어 주세요");
    expect(screen.getByRole("textbox", { name: "1행 2열, 빈칸" })).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: "1행 2열, 빈칸" }), "Paris");
    await userEvent.type(screen.getByRole("textbox", { name: "2행 1열" }), "text");
    await userEvent.click(within(toolbar).getByRole("button", { name: "삭제" }));
    expect(screen.getAllByRole("menuitem").map(({ textContent }) => textContent)).toEqual([
      "2행 삭제",
      "1열 삭제",
    ]);
    await userEvent.click(screen.getByRole("menuitem", { name: "2행 삭제" }));
    // No question: the row goes, and the snack offers it back.
    expect(screen.queryByRole("dialog", { name: "2행을 삭제할까요?" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "2행 1열" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("2행을 삭제했어요");
    expect(screen.getByRole("button", { name: "되돌리기" })).toBeInTheDocument();
    // A header offers its column alone, and a last row or column cannot go.
    select(screen.getByRole("textbox", { name: "2열 머리글" }), 0, 0);
    await userEvent.click(within(toolbar).getByRole("button", { name: "삭제" }));
    expect(
      screen
        .getAllByRole("menuitem")
        .map((item) => [item.textContent, item.hasAttribute("disabled")]),
    ).toEqual([["2열 삭제", false]]);
    await userEvent.keyboard("{Escape}");
    select(screen.getByRole("textbox", { name: "1행 1열" }), 0, 0);
    await userEvent.click(within(toolbar).getByRole("button", { name: "삭제" }));
    expect(
      screen
        .getAllByRole("menuitem")
        .map((item) => [item.textContent, item.hasAttribute("disabled")]),
    ).toEqual([
      ["1행 삭제", true],
      ["1열 삭제", false],
    ]);
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => {
      expect(db.rows.cards).toHaveLength(1);
    });
    expect(db.rows.cards[0]?.front).toMatchObject([
      {
        type: "table",
        v: 2,
        payload: { rows: [["", "Paris"]], blanks: [{ row: 0, column: 1 }], spans: [] },
      },
    ]);
  });

  it("keeps the selection on the cell the caret is in as its row goes, and puts the row back by 되돌리기", async () => {
    await newCard();
    await removeFirst();
    await add("표");
    await userEvent.type(screen.getByRole("textbox", { name: "1행 1열" }), "a");
    await userEvent.type(screen.getByRole("textbox", { name: "1행 2열" }), "Paris");
    select(screen.getByRole("textbox", { name: "1행 2열" }), 0, 5);
    await userEvent.click(screen.getByRole("button", { name: "빈칸" }));
    await userEvent.type(screen.getByRole("textbox", { name: "2행 1열" }), "b");
    select(screen.getByRole("textbox", { name: "1행 1열" }), 1, 1);
    await userEvent.click(screen.getByRole("button", { name: "삭제" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "1행 삭제" }));
    // The caret is in the cell now holding the next row's text, and that cell is the selected one.
    const kept = screen.getByRole("textbox", { name: "1행 1열" });
    expect(kept).toHaveFocus();
    expect(kept).toHaveValue("b");
    expect(screen.getByRole("button", { name: "빈칸" })).toBeEnabled();
    expect(screen.queryByRole("textbox", { name: "1행 2열, 빈칸" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1행을 삭제했어요");
    await userEvent.click(screen.getByRole("button", { name: "되돌리기" }));
    expect(screen.getByRole("textbox", { name: "1행 1열" })).toHaveValue("a");
    expect(screen.getByRole("textbox", { name: "1행 2열, 빈칸" })).toHaveValue("Paris");
    expect(screen.getByRole("textbox", { name: "2행 1열" })).toHaveValue("b");
    expect(screen.getByRole("textbox", { name: "1행 1열" })).toHaveFocus();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("focuses a new row's first cell and a new column's header, and the nearest cell as its column goes", async () => {
    await newCard();
    await removeFirst();
    await add("표");
    await userEvent.click(screen.getByRole("button", { name: "행 추가" }));
    expect(screen.getByRole("textbox", { name: "3행 1열" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "열 추가" }));
    expect(screen.getByRole("textbox", { name: "3열 머리글" })).toHaveFocus();
    select(screen.getByRole("textbox", { name: "2행 3열" }), 0, 0);
    await userEvent.click(screen.getByRole("button", { name: "삭제" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "3열 삭제" }));
    expect(screen.queryByRole("textbox", { name: "3열 머리글" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "2행 2열" })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("3열을 삭제했어요");
  });

  it("focuses a new 뜻, and deletes one at once, focusing the next and offering it back where it was", async () => {
    await newCard();
    await removeFirst();
    await add("단어");
    await userEvent.type(screen.getByRole("textbox", { name: "뜻" }), "사과");
    await userEvent.click(screen.getByRole("button", { name: "+ 뜻 추가" }));
    expect(screen.getByRole("textbox", { name: "뜻 2" })).toHaveFocus();
    await userEvent.type(screen.getByRole("textbox", { name: "뜻 2 라벨" }), "명");
    await userEvent.type(screen.getByRole("textbox", { name: "뜻 2" }), "능금");
    await userEvent.click(screen.getByRole("button", { name: "+ 뜻 추가" }));
    await userEvent.type(screen.getByRole("textbox", { name: "뜻 3" }), "배");
    await userEvent.click(screen.getByRole("button", { name: "2번째 뜻 메뉴" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "삭제" }));
    expect(screen.getByRole("textbox", { name: "뜻 2" })).toHaveValue("배");
    expect(screen.getByRole("textbox", { name: "뜻 2 라벨" })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("뜻을 삭제했어요");
    await userEvent.click(screen.getByRole("button", { name: "되돌리기" }));
    for (const [name, meaning] of [
      ["뜻 1", "사과"],
      ["뜻 2", "능금"],
      ["뜻 3", "배"],
    ])
      expect(screen.getByRole("textbox", { name })).toHaveValue(meaning);
    expect(screen.getByRole("textbox", { name: "뜻 2 라벨" })).toHaveValue("명");
    expect(screen.getByRole("textbox", { name: "뜻 2 라벨" })).toHaveFocus();
    // The last 뜻 deleted hands the focus to the one before it; an edit after it ends the offer.
    await userEvent.click(screen.getByRole("button", { name: "3번째 뜻 메뉴" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "삭제" }));
    expect(screen.getByRole("textbox", { name: "뜻 2 라벨" })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("뜻을 삭제했어요");
    await userEvent.type(screen.getByRole("textbox", { name: "뜻 2" }), "!");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("deletes a 칸 at once, focusing the nearest, and puts back the latest in place by 되돌리기", async () => {
    await newCard();
    await userEvent.type(screen.getByRole("textbox", { name: "앞면" }), "dog");
    await add("단어");
    await userEvent.type(screen.getByRole("textbox", { name: "단어" }), "apple");
    await add("빈칸 문장");
    const headings = () =>
      screen.getAllByRole("heading", { level: 3 }).map(({ textContent }) => textContent);
    // The first goes: the focus is in the next 칸's first field.
    await removeFirst();
    expect(headings()).toEqual(["단어", "빈칸 문장"]);
    expect(screen.getByRole("textbox", { name: "단어" })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("칸을 삭제했어요");
    await userEvent.click(screen.getByRole("button", { name: "되돌리기" }));
    expect(headings()).toEqual(["글", "단어", "빈칸 문장"]);
    expect(screen.getByRole("textbox", { name: "앞면" })).toHaveValue("dog");
    expect(screen.getByRole("textbox", { name: "앞면" })).toHaveFocus();
    // The last goes: the focus is in the one before it. A newer delete takes the snack's place.
    await userEvent.click(screen.getByRole("button", { name: "3번째 칸 메뉴" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "삭제" }));
    expect(screen.getByRole("textbox", { name: "단어" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "2번째 칸 메뉴" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "삭제" }));
    expect(screen.getByRole("textbox", { name: "앞면" })).toHaveFocus();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "되돌리기" }));
    expect(headings()).toEqual(["글", "단어"]);
    expect(screen.getByRole("textbox", { name: "단어" })).toHaveValue("apple");
    // With none left, "+ 칸 추가" takes the focus.
    await removeFirst();
    await removeFirst();
    expect(screen.getByRole("button", { name: "+ 칸 추가" })).toHaveFocus();
  });

  it("takes the phone's hints: the line's over two rows, and 예문's label and hint", async () => {
    await newCard();
    await add("빈칸 문장");
    expect(screen.getByRole("textbox", { name: "문장" })).toHaveAttribute(
      "placeholder",
      "문장 속 단어를 가려요",
    );
    cleanup();
    await editing(
      [
        {
          type: "senses",
          v: 2,
          id: "s",
          payload: {
            term: "apple",
            ask: "term",
            senses: [{ labels: [], meaning: "사과", examples: ["an apple"] }],
          },
        },
      ],
      [],
      "free",
      2,
    );
    const examples = screen.getByRole("textbox", { name: "뜻 예문" });
    expect(examples).toHaveAttribute("placeholder", "한 줄에 하나씩, 없으면 비워 두세요");
    expect(examples.closest("div.flex")).toHaveTextContent(/^예문an apple/);
  });

  it("draws a stored 표's toolbar whole, 빈칸 and 삭제 off until a cell is chosen", async () => {
    await editing(
      [
        {
          type: "table",
          v: 2,
          id: "t",
          payload: { columns: ["a"], rows: [["b"]], blanks: [{ row: 0, column: 0 }], spans: [] },
        },
      ],
      [],
      "free",
      2,
    );
    const toolbar = screen.getByRole("toolbar", { name: "표 도구" });
    expect(
      within(toolbar)
        .getAllByRole("button")
        .map((tool) => [tool.textContent, tool.hasAttribute("disabled")]),
    ).toEqual([
      ["행 추가", false],
      ["열 추가", false],
      ["빈칸", true],
      ["삭제", true],
    ]);
    select(screen.getByRole("textbox", { name: "1행 1열, 빈칸" }), 0, 0);
    expect(within(toolbar).getByRole("button", { name: "빈칸" })).toBeEnabled();
    expect(within(toolbar).getByRole("button", { name: "삭제" })).toBeEnabled();
  });

  it("moves a 칸 by its menu, each move off where it cannot act", async () => {
    await newCard();
    await add("단어");
    await userEvent.click(screen.getByRole("button", { name: "1번째 칸 메뉴" }));
    expect(screen.getByRole("menuitem", { name: "위로" })).toBeDisabled();
    await userEvent.click(screen.getByRole("menuitem", { name: "아래로" }));
    expect(
      screen.getAllByRole("heading", { level: 3 }).map(({ textContent }) => textContent),
    ).toEqual(["단어", "글"]);
    await userEvent.click(screen.getByRole("button", { name: "2번째 칸 메뉴" }));
    expect(screen.getByRole("menuitem", { name: "아래로" })).toBeDisabled();
    // Escape closes the menu alone, with focus back on its button.
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "새 카드" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2번째 칸 메뉴" })).toHaveFocus();
  });
});

describe("a stored card", () => {
  const photo = {
    type: "image",
    v: 1,
    id: "p",
    payload: { media: "m", width: 9, height: 9, boxes: [] },
  };
  const boxed = {
    ...photo,
    id: "b",
    payload: { ...photo.payload, media: "n", boxes: [{ id: "1", x: 0, y: 0, w: 1, h: 1 }] },
  };
  const sound = { type: "audio", v: 1, id: "s", payload: { media: "a", duration_ms: 7000 } };

  it("opens a v1 card's sides as one list of 칸, and writes it in the frame over the same id", async () => {
    const close = await editing(
      [{ type: "text", id: "f", payload: { text: "dog" } }],
      [{ type: "text", id: "g", payload: { text: "개" } }],
    );
    expect(screen.getByRole("heading", { name: "카드 편집" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "앞면" })).not.toHaveFocus();
    await userEvent.clear(screen.getByRole("textbox", { name: "뒷면" }));
    await userEvent.type(screen.getByRole("textbox", { name: "뒷면" }), "강아지");
    expect(screen.queryByRole("button", { name: "저장하고 다음 카드" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => {
      expect(close).toHaveBeenCalled();
    });
    expect(db.rows.cards).toHaveLength(1);
    expect(db.rows.cards[0]).toMatchObject({
      id: uuidOf("card"),
      back: [],
      template_version: 2,
      front: [{ id: "f", payload: { front: "dog", back: "강아지" } }],
    });
  });

  it("keeps a photo and a sound, moving a side and leaving a boxed photo sideless", async () => {
    await editing([{ type: "text", id: "f", payload: { text: "dog" } }, photo, boxed], [sound]);
    expect(screen.getAllByRole("heading", { name: "사진" })).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "소리" })).toBeInTheDocument();
    // Two chip rows: the unboxed photo's and the sound's; a boxed photo has no side.
    const sides = screen.getAllByRole("group", { name: "보일 면" });
    expect(sides).toHaveLength(2);
    const [photoSide, soundSide] = sides;
    if (!photoSide || !soundSide) throw new Error("the two rows");
    expect(within(soundSide).getByRole("button", { name: "뒷면" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await userEvent.click(within(photoSide).getByRole("button", { name: "뒷면" }));
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => {
      expect(db.rows.cards[0]?.template_version).toBe(2);
    });
    expect(db.rows.cards[0]?.front).toMatchObject([
      { type: "text", id: "f" },
      { type: "image", v: 2, id: "p", payload: { media: "m", side: "back" } },
      { type: "image", v: 2, id: "b", payload: { media: "n", boxes: [{ id: "1" }] } },
      { type: "audio", v: 2, id: "s", payload: { media: "a", side: "back" } },
    ]);
    const front = db.rows.cards[0]?.front as { payload: object }[];
    expect(front[2]?.payload).not.toHaveProperty("side");
  });

  it("offers 그래도 저장 where a key is taken, as the phone's editor", async () => {
    db.rows.cards.push({ ...cardRow("taken", "deck", "new"), card_key: "new" });
    await editing(
      [{ type: "text", id: "f", payload: { text: "dog" } }],
      [{ type: "text", id: "g", payload: { text: "개" } }],
    );
    await userEvent.clear(screen.getByRole("textbox", { name: "앞면" }));
    await userEvent.type(screen.getByRole("textbox", { name: "앞면" }), "New");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("이 노트에 이미 있는 카드예요");
    await userEvent.click(screen.getByRole("button", { name: "그래도 저장" }));
    await waitFor(() => {
      expect(db.rows.cards.find(({ id }) => id === uuidOf("card"))?.card_key).toBe("new");
    });
  });

  it("asks before leaving an edit, and closes at once with none", async () => {
    const close = await editing(
      [{ type: "text", id: "f", payload: { text: "dog" } }],
      [{ type: "text", id: "g", payload: { text: "개" } }],
    );
    await userEvent.type(screen.getByRole("textbox", { name: "앞면" }), "s");
    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.getByRole("heading", { name: "작성 중인 카드를 버릴까요?" })).toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "계속 쓰기" }));
    await userEvent.type(screen.getByRole("textbox", { name: "앞면" }), "{Backspace}");
    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(close).toHaveBeenCalled();
  });

  it.each([
    ["a later template", [{ type: "text", payload: { text: "dog" } }], [], "free", 3],
    [
      "an unknown block",
      [{ type: "text", payload: { text: "dog" } }],
      [{ type: "chart", payload: {} }],
      "free",
      1,
    ],
    [
      "a framed card's unknown 칸",
      [
        { type: "text", v: 2, payload: { front: "dog", back: "b" } },
        { type: "chart", payload: {} },
      ],
      [],
      "free",
      2,
    ],
  ])(
    "opens %s read-only, saying why in the phone's words",
    async (_, front, back, template, version) => {
      await editing(front, back, template, version);
      expect(screen.getByRole("heading", { name: "카드 편집" })).toBeInTheDocument();
      expect(
        screen.getByText(
          "새 버전의 앱에서 만든 카드라 이 버전에서는 편집할 수 없어요. 앱을 업데이트해 주세요.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByText("dog")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "저장" })).not.toBeInTheDocument();
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    },
  );

  it("opens a known card with fields, the control for the read-only line", async () => {
    await editing(
      [{ type: "text", payload: { text: "dog" } }],
      [{ type: "text", payload: { text: "b" } }],
    );
    expect(screen.getByRole("button", { name: "저장" })).toBeInTheDocument();
    expect(screen.queryByText(/새 버전의 앱에서/)).not.toBeInTheDocument();
  });
});
