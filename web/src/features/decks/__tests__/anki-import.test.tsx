import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render } from "@/testing/render";
import { FakePostgrest } from "@/testing/mocks/postgrest";
import { server } from "@/testing/mocks/server";
import { FakeStorage } from "@/testing/mocks/storage";
import { setRequestCookies } from "@/testing/next-headers";
import { signedInCookies } from "@/testing/session";

import { parseCells, sidesOf } from "../card-content";
import { NotesMenu } from "../components/notes-menu";
import { prepareImage } from "../prepare-image";

vi.mock("next/headers", () => import("@/testing/next-headers"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../prepare-image", () => ({ prepareImage: vi.fn() }));
// jsdom fetches no wasm file: the SQLite module is read from the package, as the browser loads it.
vi.mock("../anki-sqlite", () => {
  const require = createRequire(import.meta.url);
  return { loadSqlite: () => (require("sql.js/dist/sql-wasm.js") as () => Promise<never>)() };
});
vi.spyOn(console, "error").mockImplementation(() => undefined);

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const digest = createHash("sha256").update(jpeg).digest("hex");

let db: FakePostgrest;
beforeEach(async () => {
  db = new FakePostgrest();
  server.use(...db.handlers, ...new FakeStorage(db).handlers);
  setRequestCookies(await signedInCookies());
  vi.mocked(prepareImage).mockResolvedValue({
    jpeg: new Blob([jpeg], { type: "image/jpeg" }),
    sha256: digest,
    width: 8,
    height: 8,
  });
});

const fixture = (name: string) => new File([readFileSync(`e2e/fixtures/anki/${name}`)], name);

async function pick(file: File) {
  await render(() => <NotesMenu />, {});
  await userEvent.click(screen.getByRole("button", { name: "노트 메뉴" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Anki에서 가져오기" }));
  fireEvent.change(screen.getByLabelText("파일 고르기", { selector: "input" }), {
    target: { files: [file] },
  });
}

describe("notes from an Anki package", () => {
  it("states the limits before a file is picked", async () => {
    await render(() => <NotesMenu />, {});
    await userEvent.click(screen.getByRole("button", { name: "노트 메뉴" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Anki에서 가져오기" }));
    expect(screen.getByText(/100MB/u)).toBeVisible();
    expect(screen.getByText(/1,000개/u)).toBeVisible();
  });

  it("reviews before writing: the notes, their cards and how many were converted from other note types", async () => {
    await pick(fixture("spanish-latest.apkg"));
    await screen.findByRole("heading", { name: "노트 확인" });
    expect(screen.getByText("Spanish")).toBeVisible();
    expect(screen.getByText("Spanish / Verbs")).toBeVisible();
    expect(screen.getByText(/바꾼 카드가 1장 있어요/u)).toBeVisible();
    expect(db.rows.decks).toHaveLength(0);
    expect(db.rows.cards).toHaveLength(0);
  });

  it("writes one note per Anki deck on 추가, the photo stored as a 사진 칸", async () => {
    await pick(fixture("spanish-legacy.apkg"));
    await userEvent.click(await screen.findByRole("button", { name: "노트 2개, 카드 4장 추가" }));
    await waitFor(() => {
      expect(db.rows.cards).toHaveLength(4);
    });
    expect(db.rows.decks.map((row) => row.name).sort()).toEqual(["Spanish", "Spanish / Verbs"]);
    expect(db.rows.cards.every((row) => row.source === "import")).toBe(true);
    const cells = db.rows.cards.flatMap((row) => parseCells(row.front) ?? []);
    expect(cells.filter((cell) => cell.kind === "placed")).toHaveLength(1);
    expect(db.rows.media).toHaveLength(1);
    const fronts = db.rows.cards.map((row) => sidesOf(parseCells(row.front) ?? []).front.length);
    expect(fronts.every((count) => count > 0)).toBe(true);
  });

  it("writes every 글 as version 3 and every cloze as version 2 holding its text alone", async () => {
    await pick(fixture("spanish-legacy.apkg"));
    await userEvent.click(await screen.findByRole("button", { name: "노트 2개, 카드 4장 추가" }));
    await waitFor(() => {
      expect(db.rows.cards).toHaveLength(4);
    });
    const blocks = db.rows.cards.flatMap(
      (row) => row.front as { type: string; v: number; payload: object }[],
    );
    const versions = (type: string) => [
      ...new Set(blocks.filter((block) => block.type === type).map(({ v }) => v)),
    ];
    expect(versions("text")).toEqual([3]);
    // Control: the cloze is written, so its version is not read from an empty list.
    expect(versions("cloze")).toEqual([2]);
    for (const block of blocks.filter(({ type }) => type === "cloze")) {
      expect(Object.keys(block.payload)).toEqual(["text"]);
    }
  });

  it("says which photos and cards were left out after the write, and none when every photo reads", async () => {
    // Control: every photo readable, nothing left out, the sheet goes on to the notes.
    await pick(fixture("spanish-legacy.apkg"));
    await userEvent.click(await screen.findByRole("button", { name: "노트 2개, 카드 4장 추가" }));
    await waitFor(() => {
      expect(db.rows.cards).toHaveLength(4);
    });
    expect(screen.queryByText(/추가하지 못했어요/u)).toBeNull();
  });

  it("tells the user when a photo cannot be prepared and its card is not written", async () => {
    vi.mocked(prepareImage).mockResolvedValue(null);
    await pick(fixture("spanish-legacy.apkg"));
    await userEvent.click(await screen.findByRole("button", { name: "노트 2개, 카드 4장 추가" }));
    expect(
      await screen.findByText(/사진 1장을 읽지 못해 카드 1장은 추가하지 못했어요/u),
    ).toBeVisible();
    expect(db.rows.cards).toHaveLength(3);
    expect(db.rows.media).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "확인" }));
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "노트 확인" })).toBeNull();
    });
  });

  it("refuses a file that is not a package with a sentence", async () => {
    await pick(new File(["not a zip"], "a.apkg"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Anki 패키지를 읽지 못했어요");
    expect(db.rows.decks).toHaveLength(0);
  });
});
