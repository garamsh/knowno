import { createHash } from "node:crypto";

import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { testUser } from "@/testing/mocks/handlers";
import { FakePostgrest } from "@/testing/mocks/postgrest";
import { server } from "@/testing/mocks/server";
import { FakeStorage } from "@/testing/mocks/storage";
import { setRequestCookies } from "@/testing/next-headers";
import { render } from "@/testing/render";
import { testRouter } from "@/testing/router";
import { signedInCookies } from "@/testing/session";

import { AuthoringButton } from "../components/authoring-button";
import { DeckList } from "../components/deck-list";
import { prepareImage } from "../prepare-image";
import { readDeckList } from "../read-library";

vi.mock("next/headers", () => import("@/testing/next-headers"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../prepare-image", () => ({ prepareImage: vi.fn() }));

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  URL.createObjectURL = () => "blob:picked";
  URL.revokeObjectURL = () => undefined;
});
let db: FakePostgrest;
let storage: FakeStorage;
beforeEach(async () => {
  db = new FakePostgrest();
  storage = new FakeStorage(db);
  server.use(...db.handlers, ...storage.handlers);
  setRequestCookies(await signedInCookies());
  testRouter.push.mockClear();
  vi.mocked(prepareImage).mockResolvedValue({
    jpeg: new Blob([jpeg], { type: "image/jpeg" }),
    sha256: createHash("sha256").update(jpeg).digest("hex"),
    width: 1,
    height: 1,
  });
});

/** Opens 새 노트 from the 노트 page's "새 노트" and names the note [name]. */
async function newNote(name: string) {
  await render(() => <AuthoringButton compact />, {});
  await userEvent.click(screen.getByRole("button", { name: "새 노트" }));
  const sheet = within(screen.getByRole("dialog", { name: "새 노트" }));
  await userEvent.type(sheet.getByRole("textbox", { name: "노트 이름" }), name);
  return sheet;
}

/** The background photo the tile in [element] draws, or none. */
const tilePhoto = (element: HTMLElement) =>
  element.querySelector<HTMLElement>("[style*='background-image']")?.style.backgroundImage;

describe("새 노트", () => {
  it("opens on the tile it will make, then 노트 이름 in its group with its hint, then 노트 꾸미기's choices with blue chosen", async () => {
    await render(() => <AuthoringButton compact />, {});
    await userEvent.click(screen.getByRole("button", { name: "새 노트" }));
    const dialog = screen.getByRole("dialog", { name: "새 노트" });
    const sheet = within(dialog);

    // No sheet of ways to start comes first: 새 노트 is the note's own screen.
    expect(sheet.queryByRole("button", { name: "직접 입력" })).not.toBeInTheDocument();
    const name = sheet.getByRole("textbox", { name: "노트 이름" });
    // Focused once the dialog is open; e2e/home.spec.ts checks it past a browser's focusing steps.
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute("placeholder", "예: 토익 단어");
    expect(name).toHaveClass("bg-ground");
    expect(name.parentElement).toHaveClass("rounded-group", "bg-surface", "px-4", "py-4");
    expect(within(sheet.getByRole("group", { name: "아이콘" })).getAllByRole("radio")).toHaveLength(
      14,
    );
    const colors = within(sheet.getByRole("group", { name: "색" }));
    expect(colors.getAllByRole("radio").map((radio) => radio.getAttribute("aria-label"))).toEqual([
      "파랑",
      "복숭아",
      "모래",
      "회색",
    ]);
    expect(colors.getByRole("radio", { name: "파랑" })).toBeChecked();
    expect(sheet.getByRole("group", { name: "사진" })).toBeInTheDocument();
    // The preview is the tile over the name, muted until one is typed.
    expect(sheet.getByText("노트 이름", { selector: "span" })).toHaveClass("text-muted");
    await userEvent.type(name, "화학 기초");
    expect(sheet.getByText("화학 기초")).toHaveClass("text-ink");
  });

  it("previews each icon and colour on the tile and stores them with the note on 저장, opening it", async () => {
    const sheet = await newNote("토익");
    await userEvent.click(sheet.getByRole("radio", { name: "실험" }));
    await userEvent.click(sheet.getByRole("radio", { name: "모래" }));
    const tile = sheet.getByText("토익", { selector: "span" }).previousElementSibling;
    expect(tile).toHaveClass("bg-deck-sand");
    await userEvent.click(sheet.getByRole("button", { name: "저장" }));

    await waitFor(() => {
      expect(testRouter.push).toHaveBeenCalledOnce();
    });
    expect(db.rows.decks).toEqual([
      expect.objectContaining({ name: "토익", color: "sand", icon: "flask" }),
    ]);
    const id = String(db.rows.decks[0]?.id);
    expect(testRouter.push).toHaveBeenCalledWith(`/decks/${id}`);
  });

  it("opens the note with its 카드 추가 sheet up on 저장하고 카드 추가", async () => {
    const sheet = await newNote("토익");
    await userEvent.click(sheet.getByRole("button", { name: "저장하고 카드 추가" }));

    await waitFor(() => {
      expect(testRouter.push).toHaveBeenCalledOnce();
    });
    const id = String(db.rows.decks[0]?.id);
    expect(testRouter.push).toHaveBeenCalledWith(`/decks/${id}?adding=1`);
    expect(db.rows.decks[0]).toMatchObject({ color: "blue" });
  });

  it("folds the icon and colour once a photo is picked, and a note made with it shows it on its row in the 노트 list", async () => {
    const sheet = await newNote("일본어 회화");
    // Control: before the photo, the icon and colour are offered.
    expect(sheet.getByRole("group", { name: "색" })).toBeInTheDocument();
    await userEvent.upload(
      sheet.getByLabelText("앨범에서 고르기"),
      new File([jpeg], "photo.jpg", { type: "image/jpeg" }),
    );

    expect(tilePhoto(screen.getByRole("dialog", { name: "새 노트" }))).toBe('url("blob:picked")');
    expect(sheet.queryByRole("group", { name: "색" })).not.toBeInTheDocument();
    expect(sheet.queryByRole("radio", { name: "실험" })).not.toBeInTheDocument();
    expect(sheet.getByLabelText("다른 사진")).toBeInTheDocument();
    expect(sheet.getByRole("button", { name: "사진 삭제" })).toBeInTheDocument();
    await userEvent.click(sheet.getByRole("button", { name: "저장" }));

    await waitFor(() => {
      expect(testRouter.push).toHaveBeenCalledOnce();
    });
    const image = db.rows.decks[0]?.image_media_id;
    expect(typeof image).toBe("string");
    expect([...storage.objects.keys()]).toEqual([`${testUser.id}/${String(image)}`]);

    cleanup();
    const list = await readDeckList();
    if (!("library" in list)) throw new Error("the list was not read");
    await render(
      () => <DeckList rows={list.library.decks.map((deck) => ({ deck, cards: 0, today: 0 }))} />,
      {},
    );
    const row = screen.getByRole("link", { name: /^일본어 회화/ });
    expect(tilePhoto(row)).toContain(`/object/sign/media/${testUser.id}/${String(image)}`);
  });

  it("lays 저장 and 저장하고 카드 추가 out as a pair whose first is sized to its label", async () => {
    const sheet = await newNote("토익");
    const save = sheet.getByRole("button", { name: "저장" });
    const pair = save.parentElement;
    // jsdom lays nothing out, so the pair's columns are read from its classes; the e2e spec
    // measures the labels' lines at 390 px.
    expect(pair).toHaveClass("grid", "grid-cols-[auto_minmax(0,1fr)]");
    expect(pair).toContainElement(sheet.getByRole("button", { name: "저장하고 카드 추가" }));
  });
});
