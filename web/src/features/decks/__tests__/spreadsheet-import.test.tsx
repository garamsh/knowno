import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addByHand } from "@/testing/add-by-hand";
import { render } from "@/testing/render";
import { cardRow, deckRow, uuidOf } from "@/testing/library";
import { FakePostgrest } from "@/testing/mocks/postgrest";
import { server } from "@/testing/mocks/server";
import { setRequestCookies } from "@/testing/next-headers";
import { signedInCookies } from "@/testing/session";
import { xlsxOf } from "@/testing/xlsx";
import { AuthoringButton } from "../components/authoring-button";
import { NoteSettings } from "../components/note-settings";
import { parseCardContent, parseCells } from "../card-content";
import { parseDeckId } from "../library";

vi.mock("next/headers", () => import("@/testing/next-headers"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
let db: FakePostgrest;
beforeEach(async () => {
  db = new FakePostgrest();
  db.seed("decks", deckRow("deck", "단어장"));
  db.seed("cards", cardRow("apple", "deck", "apple"));
  server.use(...db.handlers);
  setRequestCookies(await signedInCookies());
});
const deckId = parseDeckId(uuidOf("deck"));
if (!deckId) throw new Error("fixture deck id");
const deck = { id: deckId, name: "단어장", publication: "private" as const };

async function openFile(file: File) {
  await render(
    () => (
      <>
        <AuthoringButton deck={deck} />
        <NoteSettings deck={deck} cardCount={0} displayName={{ name: null }} />
      </>
    ),
    {},
  );
  await addByHand();
  await userEvent.click(screen.getByRole("button", { name: "엑셀·CSV 파일" }));
  // The body's second sentence names both limits; the paragraph holds more, so this is presence.
  expect(screen.getByText(/파일은 5MB, 1,000행까지 읽어요\./u)).toBeVisible();
  fireEvent.change(screen.getByLabelText("파일 고르기", { selector: "input" }), {
    target: { files: [file] },
  });
  await screen.findByRole("heading", { name: "카드 확인" });
}
const fronts = () =>
  db.rows.cards.map((row) => {
    const [first] =
      parseCardContent({
        front: row.front,
        back: row.back,
        template: row.template,
        templateVersion: row.template_version,
      })?.front ?? [];
    return first?.kind === "text" ? first.text : null;
  });

describe("cards from a file", () => {
  it("heads 카드 확인 at the top of its content under a bar of 닫기 alone, the file's name under it, as the phone does", async () => {
    await render(
      () => (
        <>
          <AuthoringButton deck={deck} />
          <NoteSettings deck={deck} cardCount={0} displayName={{ name: null }} />
        </>
      ),
      {},
    );
    await addByHand();
    await userEvent.click(screen.getByRole("button", { name: "엑셀·CSV 파일" }));
    // Control: the sheet before it holds its title beside 닫기.
    const sheet = within(screen.getByRole("dialog", { name: "파일에서 카드 추가" }));
    expect(sheet.getByRole("button", { name: "닫기" }).parentElement).toContainElement(
      sheet.getByRole("heading", { name: "파일에서 카드 추가" }),
    );
    fireEvent.change(screen.getByLabelText("파일 고르기", { selector: "input" }), {
      target: { files: [new File(["단어,뜻\npear,배\n"], "words.csv", { type: "text/csv" })] },
    });

    const review = within(await screen.findByRole("dialog", { name: "카드 확인" }));
    const heading = review.getByRole("heading", { name: "카드 확인" });
    expect(review.getByRole("button", { name: "닫기" }).parentElement).not.toContainElement(
      heading,
    );
    expect(heading.nextElementSibling).toHaveTextContent(/^words\.csv/);
    expect(review.getByText("words.csv")).toHaveClass("text-body-strong", "text-muted");
  });

  it("maps columns under a detected header, counts skipped rows and saves only the chosen cards", async () => {
    await openFile(
      new File(
        [
          xlsxOf([
            {
              name: "단어",
              rows: [
                ["단어", "뜻", "품사"],
                ["pear", "배", "명"],
                ["", "빈 앞면"],
                ["plum", "자두", "명"],
              ],
            },
          ]),
        ],
        "words.xlsx",
      ),
    );
    expect(screen.getByRole("switch", { name: "첫 행은 머리글" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByText("앞면이나 뒷면이 빈 행 1개는 건너뛰어요")).toBeVisible();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "라벨" }), "C · 품사");
    await userEvent.click(screen.getByRole("checkbox", { name: "4행 plum" }));
    await userEvent.click(screen.getByRole("button", { name: "1장 추가" }));
    await waitFor(() => {
      expect(db.rows.cards).toHaveLength(2);
    });
    expect(fronts()).toEqual(["apple", "pear"]);
    expect(parseCells(db.rows.cards[1]?.front)).toEqual([
      expect.objectContaining({
        kind: "word",
        term: "pear",
        ask: "term",
        senses: [
          {
            labels: [{ kind: "part_of_speech", category: "noun", text: "명" }],
            meaning: "배",
            examples: [],
          },
        ],
      }),
    ]);
    expect(db.rows.cards[1]).toMatchObject({
      source: "import",
      template: "free",
      template_version: 2,
      back: [],
    });
  });

  it("reads another sheet, takes the first row as a card once the header is off, and asks for distinct columns", async () => {
    await openFile(
      new File(
        [
          xlsxOf([
            { name: "과일", rows: [["pear", "배"]] },
            {
              name: "단어",
              rows: [
                ["단어", "뜻"],
                ["plum", "자두"],
                ["kiwi", "키위"],
              ],
            },
          ]),
        ],
        "words.xlsx",
      ),
    );
    expect(screen.getByRole("heading", { name: "카드 1장" })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "시트" }), "단어");
    const header = screen.getByRole("switch", { name: "첫 행은 머리글" });
    expect(header, "the new sheet's header is detected").toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("heading", { name: "카드 2장" })).toBeInTheDocument();
    await userEvent.click(header);
    expect(header).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("heading", { name: "카드 3장" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "1행 단어" })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "뒷면" }), "A · 단어");
    expect(screen.getByRole("alert")).toHaveTextContent("항목마다 다른 열을 골라 주세요");
    expect(screen.queryByRole("heading", { name: /^카드 \d+장$/ })).not.toBeInTheDocument();
  });

  it("leaves every card out on 모두 빼기 and takes them all back on 모두 선택, and says which rows are too long", async () => {
    await openFile(
      new File([`단어,뜻\npear,배\nplum,${"자".repeat(501)}\nkiwi,키위\n`], "words.csv"),
    );
    expect(screen.getByRole("status")).toHaveTextContent("3행은 500자가 넘는 칸이 있어 뺐어요");
    await userEvent.click(screen.getByRole("button", { name: "모두 빼기" }));
    for (const name of ["2행 pear", "4행 kiwi"])
      expect(screen.getByRole("checkbox", { name })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("button", { name: "0장 추가" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "모두 선택" }));
    for (const name of ["2행 pear", "4행 kiwi"])
      expect(screen.getByRole("checkbox", { name })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "2장 추가" })).toBeEnabled();
  });

  it("names a row repeating a stored card and saves nothing until it is left out, never overwriting the stored card", async () => {
    const stored = structuredClone(db.rows.cards[0]);
    await openFile(new File(["front,back\nApple,사과\nbanana,바나나\n"], "words.csv"));
    await userEvent.click(screen.getByRole("button", { name: "2장 추가" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "2행은 이 노트에 이미 있는 카드예요",
    );
    expect(db.rows.cards).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "2행 빼기" }));
    await userEvent.click(screen.getByRole("button", { name: "1장 추가" }));
    await waitFor(() => {
      expect(db.rows.cards).toHaveLength(2);
    });
    expect(fronts()).toEqual(["apple", "banana"]);
    expect(db.rows.cards[0]).toEqual(stored);
  });

  it("names the earlier row a row repeats in the file, and adds both on 그래도 추가", async () => {
    await openFile(new File(["단어,뜻\nkiwi,키위\nKIWI,참다래\n"], "words.csv"));
    await userEvent.click(screen.getByRole("button", { name: "2장 추가" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("3행의 앞면이 2행과 같아요");
    expect(db.rows.cards).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "그래도 추가" }));
    await waitFor(() => {
      expect(db.rows.cards).toHaveLength(3);
    });
    expect(fronts()).toEqual(["apple", "kiwi", "KIWI"]);
  });

  it("states a refused file and asks before discarding read cards", async () => {
    await render(
      () => (
        <>
          <AuthoringButton deck={deck} />
          <NoteSettings deck={deck} cardCount={0} displayName={{ name: null }} />
        </>
      ),
      {},
    );
    await addByHand();
    await userEvent.click(screen.getByRole("button", { name: "엑셀·CSV 파일" }));
    fireEvent.change(screen.getByLabelText("파일 고르기", { selector: "input" }), {
      target: { files: [new File(["x"], "words.xls")] },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(".xlsx나 .csv 파일을 골라 주세요");
    fireEvent.change(screen.getByLabelText("파일 고르기", { selector: "input" }), {
      target: { files: [new File(["pear,배"], "words.csv")] },
    });
    await screen.findByRole("heading", { name: "카드 확인" });
    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.getByRole("heading", { name: "읽은 카드를 버릴까요?" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "버리기" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(db.rows.cards).toHaveLength(1);
  });
});
