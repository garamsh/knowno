import { createHash } from "node:crypto";

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { addByHand } from "@/testing/add-by-hand";
import { cardRow, deckRow, uuidOf } from "@/testing/library";
import { FakePostgrest } from "@/testing/mocks/postgrest";
import { server } from "@/testing/mocks/server";
import { FakeStorage } from "@/testing/mocks/storage";
import { setRequestCookies } from "@/testing/next-headers";
import { render } from "@/testing/render";
import { signedInCookies } from "@/testing/session";

import { parseCardContent } from "../card-content";
import { CardEditor } from "../components/card-editor";
import { NoteSettings } from "../components/note-settings";
import { type Card, parseCardId, parseDeckId } from "../library";
import { prepareImage } from "../prepare-image";

vi.mock("next/headers", () => import("@/testing/next-headers"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// jsdom decodes no image: the browser's preparation is substituted, held to the phone's by
// prepare-image.test.ts.
vi.mock("../prepare-image", () => ({ prepareImage: vi.fn() }));
vi.spyOn(console, "error").mockImplementation(() => undefined);

const deckId = parseDeckId(uuidOf("deck"));
const cardId = parseCardId(uuidOf("card"));
if (!deckId || !cardId) throw new Error("fixture ids");
const deck = { id: deckId, name: "단어장", public: false };

/** A JPEG's bytes as the browser prepared one. */
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

beforeAll(() => {
  URL.createObjectURL = () => "blob:pasted";
  URL.revokeObjectURL = () => undefined;
});

let db: FakePostgrest;
beforeEach(async () => {
  db = new FakePostgrest();
  server.use(...db.handlers, ...new FakeStorage(db).handlers);
  setRequestCookies(await signedInCookies());
  db.rows.decks.push(deckRow("deck", "단어장"));
  vi.mocked(prepareImage).mockResolvedValue({
    jpeg: new Blob([jpeg], { type: "image/jpeg" }),
    sha256: createHash("sha256").update(jpeg).digest("hex"),
    width: 400,
    height: 300,
  });
});

/** Opens direct entry from the deck's "카드 추가". */
async function newCard() {
  await render(() => <NoteSettings deck={deck} cardCount={0} displayName={{ name: null }} />, {});
  await addByHand();
  await userEvent.click(screen.getByRole("button", { name: "직접 입력" }));
}

/** The editor over a stored card of [front] blocks, which [db] holds. */
async function editing(front: unknown) {
  db.rows.cards.push({
    ...cardRow("card", "deck", "old"),
    front,
    back: [],
    template: "free",
    template_version: 2,
  });
  const content = parseCardContent({ front, back: [], template: "free", templateVersion: 2 });
  if (!content) throw new Error("a fixture did not parse");
  const card: Card = { id: cardId as never, deckId: deckId as never, createdAt: 0, ...content };
  await render(() => <CardEditor deck={deck} card={card} close={vi.fn()} />, {});
}

const add = async (name: string) => {
  await userEvent.click(screen.getByRole("button", { name: "+ 칸 추가" }));
  await userEvent.click(
    within(screen.getByRole("dialog", { name: "칸 추가" })).getByRole("button", { name }),
  );
};
const headings = () =>
  screen.getAllByRole("heading", { level: 3 }).map(({ textContent }) => textContent);
/** Selects [start] to [end] of [field], as a press and drag would. */
function select(field: HTMLElement, start: number, end: number) {
  if (!(field instanceof HTMLTextAreaElement)) throw new Error("not a line");
  field.focus();
  field.setSelectionRange(start, end);
  fireEvent.select(field);
}

describe("a 글's fields as markup", () => {
  it("shows the formatting under a field once its text holds a mark, and nothing while it reads as written", async () => {
    await newCard();
    const front = screen.getByRole("textbox", { name: "앞면" });

    await userEvent.type(front, "plain words");
    expect(screen.queryByRole("group", { name: "미리 보기" })).not.toBeInTheDocument();
    await userEvent.type(front, " and **bold** and `code`");

    const preview = screen.getByRole("group", { name: "미리 보기" });
    expect(preview.querySelector("strong")).toHaveTextContent("bold");
    expect(preview.querySelector("code")).toHaveTextContent("code");
    expect(preview).not.toHaveTextContent("**");
  });

  it("goes on with a list as a line is broken, numbers counting on, and ends it on an empty item", async () => {
    await newCard();
    const front = screen.getByRole("textbox", { name: "앞면" });

    await userEvent.type(front, "- one{Enter}two{Enter}three");
    expect(front).toHaveValue("- one\n- two\n- three");
    await userEvent.type(front, "{Enter}{Enter}after");
    expect(front).toHaveValue("- one\n- two\n- three\n\nafter");

    const back = screen.getByRole("textbox", { name: "뒷면" });
    await userEvent.type(back, "1. a{Enter}b");
    expect(back).toHaveValue("1. a\n2. b");
  });

  it("types a line break as it is outside a list, and with Shift inside one", async () => {
    await newCard();
    const front = screen.getByRole("textbox", { name: "앞면" });

    await userEvent.type(front, "a{Enter}b");
    expect(front).toHaveValue("a\nb");
    await userEvent.type(front, "{Enter}- c{Shift>}{Enter}{/Shift}d");
    expect(front).toHaveValue("a\nb\n- c\nd");
  });

  it("saves what was typed as version 3, the marks as typed", async () => {
    await newCard();
    await userEvent.type(screen.getByRole("textbox", { name: "앞면" }), "**apple**");
    await userEvent.type(screen.getByRole("textbox", { name: "뒷면" }), "- 사과{Enter}과일");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => {
      expect(db.rows.cards).toHaveLength(1);
    });
    expect(db.rows.cards[0]?.front).toMatchObject([
      { type: "text", v: 3, payload: { front: "**apple**", back: "- 사과\n- 과일" } },
    ]);
  });

  it("opens a stored version 2 글 as written, with no preview, and stores it as version 3 escaped once edited", async () => {
    await editing([{ type: "text", v: 2, id: "t", payload: { front: "2*3*4", back: "- a" } }]);
    const front = screen.getByRole("textbox", { name: "앞면" });
    expect(front).toHaveValue("2*3*4");

    await userEvent.type(front, "{Backspace}5");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => {
      expect(db.rows.cards[0]?.front).toMatchObject([
        { type: "text", v: 3, payload: { front: "2\\*3\\*5", back: "\\- a" } },
      ]);
    });
  });
});

describe("a paste of Markdown", () => {
  it("makes a 표 of a table after the 글, and leaves the field as it was", async () => {
    await newCard();
    const front = screen.getByRole("textbox", { name: "앞면" });
    await userEvent.type(front, "words");

    await userEvent.paste("| word | meaning |\n| --- | --- |\n| apple | 사과 |");

    expect(front).toHaveValue("words");
    expect(headings()).toEqual(["글", "표"]);
    expect(screen.getByRole("textbox", { name: "1열 머리글" })).toHaveValue("word");
    expect(screen.getByRole("textbox", { name: "2열 머리글" })).toHaveValue("meaning");
  });

  it("puts the paste in the 글 as it is where it holds no table and no image", async () => {
    await newCard();
    const front = screen.getByRole("textbox", { name: "앞면" });

    await userEvent.click(front);
    await userEvent.paste("# Title\n- a\n- b");

    expect(front).toHaveValue("# Title\n- a\n- b");
    expect(headings()).toEqual(["글"]);
  });

  it("takes the place of an empty 글, the rest of the paste a 글 of its own", async () => {
    await newCard();
    await userEvent.click(screen.getByRole("textbox", { name: "앞면" }));

    await userEvent.paste("before\n| a | b |\n|---|---|\n| 1 | 2 |\nafter");

    expect(headings()).toEqual(["글", "표", "글"]);
    const [first, second] = screen.getAllByRole("textbox", { name: "앞면" });
    expect(first).toHaveValue("before");
    expect(second).toHaveValue("after");
  });

  it("makes a 사진 of an https image, its picture fetched and stored as a picked photo is", async () => {
    server.use(
      http.get("https://images.test/cat.png", () => HttpResponse.arrayBuffer(new ArrayBuffer(8))),
    );
    await newCard();
    await userEvent.type(screen.getByRole("textbox", { name: "앞면" }), "a cat");
    await userEvent.type(screen.getByRole("textbox", { name: "뒷면" }), "고양이");

    await userEvent.paste("![cat](https://images.test/cat.png)");

    expect(headings()).toEqual(["글", "사진"]);
    expect(await screen.findByRole("button", { name: "사진 삭제" })).toBeInTheDocument();
    expect(prepareImage).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => {
      expect(db.rows.cards).toHaveLength(1);
    });
    expect(db.rows.cards[0]?.front).toMatchObject([
      { type: "text", v: 3 },
      { type: "image", v: 2, payload: { width: 400, height: 300, side: "front" } },
    ]);
  });

  it("says a picture that could not be fetched failed, and leaves an empty 사진", async () => {
    server.use(
      http.get("https://images.test/gone.png", () => new HttpResponse(null, { status: 404 })),
    );
    await newCard();
    await userEvent.click(screen.getByRole("textbox", { name: "앞면" }));

    await userEvent.paste("![x](https://images.test/gone.png)");

    expect(await screen.findByRole("status")).toHaveTextContent(
      "붙여넣은 사진을 가져오지 못했어요",
    );
    expect(headings()).toEqual(["사진"]);
    expect(screen.queryByRole("button", { name: "사진 삭제" })).not.toBeInTheDocument();
    expect(prepareImage).not.toHaveBeenCalled();
  });
});

describe("a 빈칸 문장 of Anki's syntax", () => {
  it("wraps the selection in the next free number under 가리기, and says it needs a cloze until it has one", async () => {
    await newCard();
    await add("빈칸 문장");
    const text = screen.getByRole("textbox", { name: "문장" });
    await userEvent.type(text, "Paris is the capital of France");

    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByRole("alert")).toHaveTextContent("빈칸을 하나 이상 넣어 주세요");
    select(text, 0, 5);
    await userEvent.click(screen.getByRole("button", { name: "가리기" }));
    expect(text).toHaveValue("{{c1::Paris}} is the capital of France");
    expect(text).toHaveFocus();
    select(text, 32, 38);
    await userEvent.click(screen.getByRole("button", { name: "가리기" }));

    expect(text).toHaveValue("{{c1::Paris}} is the capital of {{c2::France}}");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("offers 가리기 풀기 in a cloze, which gives its answer back", async () => {
    await newCard();
    await add("빈칸 문장");
    const text = screen.getByRole("textbox", { name: "문장" });
    await userEvent.type(text, "Paris is big");
    select(text, 0, 5);
    await userEvent.click(screen.getByRole("button", { name: "가리기" }));

    select(text, 8, 8);
    await userEvent.click(screen.getByRole("button", { name: "가리기 풀기" }));

    expect(text).toHaveValue("Paris is big");
    expect(screen.getByRole("button", { name: "가리기" })).toBeInTheDocument();
  });

  it("keeps 가리기 under a press elsewhere until it ends, so the control pressed stays put", async () => {
    await newCard();
    await add("빈칸 문장");
    await userEvent.click(screen.getByRole("textbox", { name: "문장" }));
    const more = screen.getByRole("button", { name: "+ 칸 추가" });
    // One session, so the release ends the press begun by the first call.
    const user = userEvent.setup();
    await user.pointer({ keys: "[MouseLeft>]", target: more });
    expect(more).toHaveFocus();
    expect(screen.getByRole("button", { name: "가리기" })).toBeInTheDocument();
    await user.pointer({ keys: "[/MouseLeft]", target: more });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "가리기" })).not.toBeInTheDocument();
    });
    // The press was a click on the control it started on.
    expect(screen.getByRole("dialog", { name: "칸 추가" })).toBeInTheDocument();
  });

  it("shows the text as study draws it: each cloze a blank with its hint, or its answer", async () => {
    await newCard();
    await add("빈칸 문장");
    const text = screen.getByRole("textbox", { name: "문장" });
    fireEvent.change(text, { target: { value: "{{c1::Paris::city}} and {{c2::Rome}}" } });

    const preview = screen.getByRole("group", { name: "미리 보기" });
    expect(
      [...preview.querySelectorAll('[data-blank="preview"]')].map((blank) => blank.textContent),
    ).toEqual(["city", "Rome"]);
    expect(preview).not.toHaveTextContent("{{");
  });

  it("saves its text as version 2, and a stored one opens as its text", async () => {
    await newCard();
    await userEvent.click(screen.getByRole("button", { name: "1번째 칸 메뉴" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "삭제" }));
    await add("빈칸 문장");
    fireEvent.change(screen.getByRole("textbox", { name: "문장" }), {
      target: { value: "{{c1::Paris}} is big" },
    });
    await userEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => {
      expect(db.rows.cards).toHaveLength(1);
    });
    expect(db.rows.cards[0]?.front).toMatchObject([
      { type: "cloze", v: 2, payload: { text: "{{c1::Paris}} is big" } },
    ]);
  });

  it("opens a stored version 2 cloze as its text, with the same cloze numbers kept on an edit", async () => {
    await editing([
      { type: "cloze", v: 2, id: "c", payload: { text: "{{c1::a}} and {{c1::b}} {{c2::c}}" } },
    ]);
    const text = screen.getByRole("textbox", { name: "문장" });
    expect(text).toHaveValue("{{c1::a}} and {{c1::b}} {{c2::c}}");

    // After the first cloze and its space, so in none.
    select(text, 10, 10);
    await userEvent.click(screen.getByRole("button", { name: "가리기" }));

    expect(text).toHaveValue("{{c1::a}} {{c3::}}and {{c1::b}} {{c2::c}}");
  });
});
