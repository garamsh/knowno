import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { cardRow, deckRow, uuidOf } from "@/testing/library";
import { FakePostgrest } from "@/testing/mocks/postgrest";
import { server } from "@/testing/mocks/server";
import { setRequestCookies } from "@/testing/next-headers";
import { render } from "@/testing/render";
import { signedInCookies } from "@/testing/session";

import { parseCardContent } from "../card-content";
import { AuthoringButton, CardEditor } from "../components/authoring-button";
import { parseDeckId, parseCardId, type Card } from "../library";

vi.mock("next/headers", () => import("@/testing/next-headers"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const deckId = parseDeckId(uuidOf("deck"));
const cardId = parseCardId(uuidOf("card"));
if (!deckId || !cardId) throw new Error("fixture ids");
const deck = { id: deckId, name: "단어장", public: false };

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
let db: FakePostgrest;
beforeEach(async () => {
  db = new FakePostgrest();
  server.use(...db.handlers);
  setRequestCookies(await signedInCookies());
  db.rows.decks.push(deckRow("deck", "단어장"));
});

/** Opens direct entry from the deck's "카드 추가". */
async function newCard() {
  await render(() => <AuthoringButton deck={deck} />, {});
  await userEvent.click(screen.getByRole("button", { name: "카드 추가" }));
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

  it("offers 글, 단어, 빈칸 문장 and 표 under '+ 칸 추가', and no photo or sound the web cannot pick", async () => {
    await newCard();
    await userEvent.click(screen.getByRole("button", { name: "+ 칸 추가" }));
    const sheet = screen.getByRole("dialog", { name: "칸 추가" });
    expect(
      within(sheet)
        .getAllByRole("button")
        .map((item) => item.textContent),
    ).toEqual([
      "",
      "글",
      "단어단어와 뜻을 함께 적어요",
      "빈칸 문장문장 속 단어를 가려요",
      "표가릴 부분을 골라요",
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

  it("makes a table's cell a blank from its toolbar, and asks before removing a row with text", async () => {
    await newCard();
    await removeFirst();
    await add("표");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByRole("alert")).toHaveTextContent("빈칸으로 할 칸을 하나 이상 골라 주세요");
    const cell = screen.getByRole("textbox", { name: "1행 2열" });
    select(cell, 0, 0);
    await userEvent.click(screen.getByRole("button", { name: "빈칸" }));
    expect(screen.getByRole("alert")).toHaveTextContent("빈칸으로 고른 칸에 내용을 적어 주세요");
    expect(screen.getByRole("textbox", { name: "1행 2열, 빈칸" })).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: "1행 2열, 빈칸" }), "Paris");
    await userEvent.type(screen.getByRole("textbox", { name: "2행 1열" }), "text");
    await userEvent.click(screen.getByRole("button", { name: "2행 삭제" }));
    const asked = screen.getByRole("dialog", { name: "2행을 삭제할까요?" });
    await userEvent.click(within(asked).getByRole("button", { name: "삭제" }));
    expect(screen.queryByRole("textbox", { name: "2행 1열" })).not.toBeInTheDocument();
    // Control: an empty row goes without asking.
    await userEvent.click(screen.getByRole("button", { name: "행 추가" }));
    select(screen.getByRole("textbox", { name: "2행 1열" }), 0, 0);
    await userEvent.click(screen.getByRole("button", { name: "2행 삭제" }));
    expect(screen.queryByRole("dialog", { name: "2행을 삭제할까요?" })).not.toBeInTheDocument();
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
