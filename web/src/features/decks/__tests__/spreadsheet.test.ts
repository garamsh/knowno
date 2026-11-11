import { describe, expect, it, vi } from "vitest";
import { type TestCell, xlsxOf } from "@/testing/xlsx";
import { parseCells, sidesOf } from "../card-content";
import {
  fileLimitBytes,
  openSpreadsheet,
  type Refusal,
  rowLimit,
  type SheetRow,
  type Spreadsheet,
} from "../spreadsheet";
import { cardsOfRows, cellLimit, headerByDefault } from "../spreadsheet-cards";
import { textContent } from "@/testing/content";

const fileOf = (bytes: Uint8Array<ArrayBuffer> | string, name: string) =>
  new File([typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes], name);

async function opened(file: File): Promise<Spreadsheet> {
  const book = await openSpreadsheet(file);
  if ("refused" in book) throw new Error(`refused: ${book.refused}`);
  return book;
}
function rowsOf(read: SheetRow[] | Refusal): SheetRow[] {
  if ("refused" in read) throw new Error(`refused: ${read.refused}`);
  return read;
}
const texts = (rows: SheetRow[]) => rows.map((row) => row.cells.map((cell) => cell.text));
const sheet = async (rows: TestCell[][]) =>
  rowsOf((await opened(fileOf(xlsxOf([{ name: "단어", rows }]), "words.xlsx"))).read(0));
const csv = async (text: string) => rowsOf((await opened(fileOf(text, "words.csv"))).read(0));
const ids = (row: number) => `00000000-0000-7000-8000-${String(row).padStart(12, "0")}`;
/** The sides a row's 칸 draw. */
const cellsOf = (card: { blocks: unknown }) => sidesOf(parseCells(card.blocks) ?? []);

describe("the limits, refused before the file is read", () => {
  it("refuses a file over 5 MB without reading a byte, beside one at the limit that is read", async () => {
    const sized = (size: number) => {
      const file = fileOf("단어,뜻\napple,사과\n", "words.csv");
      Object.defineProperty(file, "size", { value: size });
      const read = vi.spyOn(file, "arrayBuffer");
      return { file, read };
    };
    const over = sized(fileLimitBytes + 1);
    expect(await openSpreadsheet(over.file)).toEqual({
      refused: "파일이 5MB보다 커서 읽지 못했어요. 파일을 나눠 다시 골라 주세요.",
    });
    expect(over.read).not.toHaveBeenCalled();
    const at = sized(fileLimitBytes);
    expect(texts(rowsOf((await opened(at.file)).read(0)))).toEqual([
      ["단어", "뜻"],
      ["apple", "사과"],
    ]);
    expect(at.read).toHaveBeenCalledOnce();
  });

  it("refuses a sheet of more than 1,000 rows holding text, beside one of 1,000 with empty rows among them", async () => {
    const lines = (count: number) =>
      Array.from({ length: count }, (_, at) => `word ${String(at)},뜻 ${String(at)}`);
    const refusal = {
      refused: "행이 1,000개보다 많아 읽지 못했어요. 파일을 나눠 다시 골라 주세요.",
    };
    expect((await opened(fileOf(lines(rowLimit + 1).join("\n"), "w.csv"))).read(0)).toEqual(
      refusal,
    );
    const atLimit = [...lines(rowLimit), "", ",", ""].join("\n");
    expect(await csv(atLimit)).toHaveLength(rowLimit);
    const book = (count: number) =>
      fileOf(
        xlsxOf([
          {
            name: "단어",
            rows: Array.from({ length: count }, (_, at) => [`word ${String(at)}`, at]),
          },
        ]),
        "w.xlsx",
      );
    expect((await opened(book(rowLimit + 1))).read(0)).toEqual(refusal);
    expect(rowsOf((await opened(book(rowLimit))).read(0))).toHaveLength(rowLimit);
  });

  it("refuses a file that is neither .xlsx nor .csv, and a CSV not in UTF-8, beside the same text in UTF-8", async () => {
    expect(await openSpreadsheet(fileOf("a,b", "words.xls"))).toEqual({
      refused: ".xlsx나 .csv 파일을 골라 주세요",
    });
    // 사과,apple in EUC-KR, as Excel's plain CSV writes it on a Korean system.
    const eucKr = new Uint8Array([0xbb, 0xe7, 0xb0, 0xfa, 0x2c, 0x61, 0x70, 0x70, 0x6c, 0x65]);
    expect(await openSpreadsheet(fileOf(eucKr, "words.csv"))).toEqual({
      refused: "CSV를 읽지 못했어요. UTF-8 CSV로 저장해 다시 골라 주세요.",
    });
    expect(texts(await csv("사과,apple"))).toEqual([["사과", "apple"]]);
  });
});

describe("a cell's shown text", () => {
  it("draws a number and a date through their formats, a formula as its cached value, and General as Excel does", async () => {
    const rows = await sheet([
      ["천 단위", { number: 1234.5, format: "#,##0.00" }],
      ["퍼센트", { number: 0.256, format: "0.0%" }],
      ["날짜", { number: 46324, format: 14 }],
      ["한국어 날짜", { number: 46324, format: 'yyyy"년" m"월" d"일"' }],
      ["시각", { number: 0.75, format: "h:mm" }],
      ["수식", { formula: "B1*2", cached: 2469 }],
      ["글 수식", { formula: '"사"&"과"', cached: "사과" }],
      ["캐시 없는 수식", { formula: "B1", cached: null }, "남은 칸"],
      ["일반", 0.1 + 0.2],
    ]);
    expect(texts(rows).map((row) => row[1])).toEqual([
      "1,234.50",
      "25.6%",
      "2026-10-29",
      "2026년 10월 29일",
      "18:00",
      "2469",
      "사과",
      "",
      "0.3",
    ]);
    expect(rows.map((row) => row.cells[1]?.isText)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
    ]);
  });

  it("counts a date from 1904 where the workbook says so", async () => {
    const book = await opened(
      fileOf(
        xlsxOf([{ name: "단어", rows: [[{ number: 46324, format: 14 }]] }], { date1904: true }),
        "w.xlsx",
      ),
    );
    expect(texts(rowsOf(book.read(0)))).toEqual([["2030-10-30"]]);
  });

  it("trims a cell, keeps its line breaks, and decodes Excel's escaped carriage return", async () => {
    expect(texts(await sheet([["  첫 줄_x000D_\n둘째 줄  ", "\n뜻\n"]]))).toEqual([
      ["첫 줄\n둘째 줄", "뜻"],
    ]);
  });

  it("reads a CSV with a byte order mark, Korean text, quoted commas, quotes and line breaks", async () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const body = new TextEncoder().encode(
      '앞면,뒷면\r\n사과,"과일, 빨간"\r\n"줄\n바꿈","따옴표 ""안"""\r\n',
    );
    const rows = rowsOf(
      (await opened(fileOf(new Uint8Array([...bom, ...body]), "단어.csv"))).read(0),
    );
    expect(texts(rows)).toEqual([
      ["앞면", "뒷면"],
      ["사과", "과일, 빨간"],
      ["줄\n바꿈", '따옴표 "안"'],
    ]);
    const quotedFirst = new TextEncoder().encode('"앞,면",뒷면');
    expect(
      texts(
        rowsOf((await opened(fileOf(new Uint8Array([...bom, ...quotedFirst]), "q.csv"))).read(0)),
      ),
    ).toEqual([["앞,면", "뒷면"]]);
  });

  it("lists the visible sheets and reads the one chosen", async () => {
    const book = await opened(
      fileOf(
        xlsxOf([
          { name: "명사", rows: [["apple", "사과"]] },
          { name: "숨김", rows: [["secret", "비밀"]], hidden: true },
          { name: "동사", rows: [["run", "달리다"]] },
        ]),
        "w.xlsx",
      ),
    );
    expect(book.sheets).toEqual(["명사", "동사"]);
    expect(texts(rowsOf(book.read(1)))).toEqual([["run", "달리다"]]);
  });
});

describe("the header toggle's default", () => {
  it("is on for a first row holding a common column name, trimmed and case-folded", async () => {
    expect(headerByDefault(await csv("단어,뜻\napple,사과\nbanana,바나나"))).toBe(true);
    expect(headerByDefault(await csv(" Word ,설명\napple,사과"))).toBe(true);
    expect(headerByDefault(await csv("메모,DEFINITION\napple,사과"))).toBe(true);
  });

  it("is on for text over a column of numbers or dates, against the same row over text", async () => {
    const over = (below: TestCell) =>
      sheet([
        ["이름", "날짜"],
        ["kim", below],
        ["lee", null],
      ]);
    expect(headerByDefault(await over({ number: 46324, format: 14 }))).toBe(true);
    expect(headerByDefault(await over(90))).toBe(true);
    expect(headerByDefault(await over("어제"))).toBe(false);
    expect(headerByDefault(await csv("이름,점수\nkim,90\nlee,85"))).toBe(true);
  });

  it("is off for a headerless word list, whose first word becomes a card", async () => {
    const rows = await csv("apple,사과\nbanana,바나나");
    const header = headerByDefault(rows);
    expect(header).toBe(false);
    const result = cardsOfRows(
      rows,
      { front: 0, back: 1, label: null, example: null },
      header,
      ids,
    );
    expect(result.cards.map((card) => [card.row, cellsOf(card).front])).toEqual([
      [1, [textContent("apple")]],
      [2, [textContent("banana")]],
    ]);
  });

  it("is off for a number over numbers and for a sheet of one row, against a named header", async () => {
    expect(
      headerByDefault(
        await sheet([
          ["apple", 1],
          ["banana", 2],
        ]),
      ),
    ).toBe(false);
    expect(headerByDefault(await csv("2026,연도\n2027,연도"))).toBe(false);
    expect(headerByDefault(await csv("단어,뜻"))).toBe(false);
    expect(headerByDefault(await csv("단어,뜻\napple,사과"))).toBe(true);
  });
});

describe("rows into cards", () => {
  const front = (card: { blocks: unknown }) => cellsOf(card).front;
  const back = (card: { blocks: unknown }) => cellsOf(card).back;

  it("maps the chosen front and back columns to a 글, ignoring the others, below a header", async () => {
    const rows = await csv("메모,뜻,단어\n외우기,사과,apple\n,바나나,banana");
    const result = cardsOfRows(rows, { front: 2, back: 1, label: null, example: null }, true, ids);
    expect(result.cards.map((card) => [card.row, front(card), back(card)])).toEqual([
      [2, [textContent("apple")], [textContent("사과")]],
      [3, [textContent("banana")], [textContent("바나나")]],
    ]);
    expect(result.cards.map((card) => card.id)).toEqual([ids(2), ids(3)]);
    expect(
      cardsOfRows(rows, { front: 2, back: 1, label: null, example: null }, false, ids).cards[0]
        ?.row,
    ).toBe(1);
  });

  it("fills a 단어's meaning from optional label and example columns, as direct entry writes it", async () => {
    const rows = await csv('apple,사과,명,"an apple\nan apple a day"\nrun,달리다,,');
    const result = cardsOfRows(rows, { front: 0, back: 1, label: 2, example: 3 }, false, ids);
    expect(result.cards.map(back)).toEqual([
      [
        {
          kind: "senses",
          senses: [
            {
              labels: [{ kind: "part_of_speech", category: "noun", text: "명" }],
              meaning: "사과",
              examples: ["an apple", "an apple a day"],
            },
          ],
        },
      ],
      [{ kind: "senses", senses: [{ labels: [], meaning: "달리다", examples: [] }] }],
    ]);
    const labelOnly = cardsOfRows(rows, { front: 0, back: 1, label: 2, example: null }, false, ids);
    expect(back(labelOnly.cards[0] ?? { blocks: [] })).toEqual([
      {
        kind: "senses",
        senses: [
          {
            labels: [{ kind: "part_of_speech", category: "noun", text: "명" }],
            meaning: "사과",
            examples: [],
          },
        ],
      },
    ]);
  });

  it("skips a row with an empty front or back and counts it, and an empty row not at all", async () => {
    const rows = await csv("apple,사과\n,바나나\ncherry,\n,,\n\ndate,대추");
    const result = cardsOfRows(rows, { front: 0, back: 1, label: null, example: null }, false, ids);
    expect(result.cards.map((card) => card.row)).toEqual([1, 6]);
    expect(result.skipped).toEqual([2, 3]);
    expect(result.tooLong).toEqual([]);
  });

  it(`refuses a row whose used cell is over ${String(cellLimit)} characters and names it, beside one at the limit`, async () => {
    const at = "가".repeat(cellLimit);
    const over = "😀".repeat(cellLimit + 1);
    const rows = await csv(`ok,${at}\nlong,${over}\nexample,뜻,,${over}\nignored,뜻,${over}`);
    const result = cardsOfRows(rows, { front: 0, back: 1, label: null, example: 3 }, false, ids);
    expect(result.cards.map((card) => card.row)).toEqual([1, 4]);
    expect(result.tooLong).toEqual([2, 3]);
  });
});
