import { createHash } from "node:crypto";

import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { revalidatePath } from "next/cache";
import { beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { cardRow, deckRow, uuidOf } from "@/testing/library";
import { testUser } from "@/testing/mocks/handlers";
import { FakePostgrest } from "@/testing/mocks/postgrest";
import { FakePublishNote } from "@/testing/mocks/publish-note";
import { server } from "@/testing/mocks/server";
import { FakeStorage } from "@/testing/mocks/storage";
import { setRequestCookies } from "@/testing/next-headers";
import { render } from "@/testing/render";
import { testRouter } from "@/testing/router";
import { signedInCookies } from "@/testing/session";

import { type DisplayNameRead, NoteSettings } from "../components/note-settings";
import { parseCardContent } from "../card-content";
import type { Card, CardId, Deck, DeckId } from "../library";
import { prepareImage } from "../prepare-image";

vi.mock("next/headers", () => import("@/testing/next-headers"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// jsdom decodes no image: the crop is prepare-image.test.ts's, and here gives a fixed JPEG.
vi.mock("../prepare-image", () => ({ prepareImage: vi.fn() }));

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9]);

beforeAll(() => {
  URL.createObjectURL = () => "blob:picked";
  URL.revokeObjectURL = () => undefined;
});
let db: FakePostgrest;
let storage: FakeStorage;
let publishNote: FakePublishNote;
beforeEach(async () => {
  db = new FakePostgrest();
  storage = new FakeStorage(db);
  publishNote = new FakePublishNote(db);
  server.use(...db.handlers, ...storage.handlers, ...publishNote.handlers);
  setRequestCookies(await signedInCookies());
  testRouter.push.mockClear();
  testRouter.refresh.mockClear();
  vi.mocked(prepareImage).mockResolvedValue({
    jpeg: new Blob([jpeg], { type: "image/jpeg" }),
    sha256: createHash("sha256").update(jpeg).digest("hex"),
    width: 1,
    height: 1,
  });
});

const french: Deck = { id: uuidOf("deck") as DeckId, name: "French", public: false };

/** Renders 노트 설정 over [deck] and picks [item] from its menu. */
async function choose(
  item: string,
  {
    deck = french,
    cardCount = 2,
    displayName = { name: null },
    cards = [],
  }: { deck?: Deck; cardCount?: number; displayName?: DisplayNameRead; cards?: Card[] } = {},
) {
  await render(
    () => (
      <NoteSettings deck={deck} cardCount={cardCount} displayName={displayName} cards={cards} />
    ),
    {},
  );
  await userEvent.click(screen.getByRole("button", { name: "노트 설정" }));
  await userEvent.click(screen.getByRole("menuitem", { name: item }));
}

describe("노트 설정", () => {
  it("renames the note from 노트 이름 바꾸기, asking for a name when the field is emptied", async () => {
    db.seed("decks", deckRow("deck", "French"));
    await choose("이름 바꾸기");
    const sheet = within(screen.getByRole("dialog", { name: "노트 이름 바꾸기" }));
    const field = sheet.getByRole("textbox", { name: "노트 이름" });
    expect(field).toHaveValue("French");
    await userEvent.clear(field);
    await userEvent.click(sheet.getByRole("button", { name: "저장" }));
    expect(sheet.getByRole("alert")).toHaveTextContent("이름을 입력해 주세요");
    await userEvent.type(field, "Français");
    await userEvent.click(sheet.getByRole("button", { name: "저장" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(db.rows.decks[0]).toMatchObject({ name: "Français" });
    // The rename's revalidation re-renders the note in its response, and nothing renders it again.
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(testRouter.refresh).not.toHaveBeenCalled();
  });

  it("previews a picked photo on the tile in 노트 꾸미기 and stores it with the icon and colour", async () => {
    db.seed("decks", deckRow("deck", "French"));
    await choose("노트 꾸미기");
    const dialog = screen.getByRole("dialog", { name: "노트 꾸미기" });
    const sheet = within(dialog);
    expect(
      within(sheet.getByRole("group", { name: "아이콘" }))
        .getAllByRole("radio")
        .map((radio) => radio.getAttribute("aria-label")),
    ).toEqual([
      "카드 묶음",
      "책",
      "언어",
      "연필",
      "실험",
      "계산기",
      "지구본",
      "음악",
      "팔레트",
      "두뇌",
      "코드",
      "건축물",
      "서류 가방",
      "별",
    ]);
    expect(sheet.getByRole("radio", { name: "카드 묶음" })).toBeChecked();
    expect(sheet.queryByRole("button", { name: "사진 삭제" })).not.toBeInTheDocument();
    expect(dialog.querySelector("[style*='background-image']")).toBeNull();

    await userEvent.click(sheet.getByRole("radio", { name: "별" }));
    await userEvent.click(sheet.getByRole("radio", { name: "모래" }));
    await userEvent.upload(
      sheet.getByLabelText("앨범에서 고르기"),
      new File([new Uint8Array([1])], "photo.png", { type: "image/png" }),
    );
    await waitFor(() => {
      expect(dialog.querySelector("[style*='background-image']")).toHaveStyle({
        backgroundImage: 'url("blob:picked")',
      });
    });
    expect(sheet.getByRole("button", { name: "사진 삭제" })).toBeInTheDocument();
    await userEvent.click(sheet.getByRole("button", { name: "저장" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    const image = String(db.rows.decks[0]?.image_media_id);
    expect(db.rows.decks[0]).toMatchObject({ icon: "star", color: "sand" });
    expect(storage.objects.get(`${testUser.id}/${image}`)?.bytes).toEqual(jpeg);
  });

  it("says under the photo's buttons that a failed upload left the note as it was, and stays open", async () => {
    db.seed("decks", deckRow("deck", "French"));
    storage.fail("upload");
    await choose("노트 꾸미기");
    const sheet = within(screen.getByRole("dialog", { name: "노트 꾸미기" }));
    await userEvent.upload(
      sheet.getByLabelText("사진 찍기"),
      new File([new Uint8Array([1])], "photo.jpg", { type: "image/jpeg" }),
    );
    await userEvent.click(sheet.getByRole("button", { name: "저장" }));
    expect(await sheet.findByRole("alert")).toHaveTextContent(
      "사진을 저장하지 못했어요. 노트는 그대로예요. 다시 시도해 주세요.",
    );
    expect(db.rows.decks[0]?.image_media_id).toBeUndefined();
    expect(db.requests).not.toContain("PATCH decks");
  });

  it("says a photo the browser cannot read could not be loaded, and stores nothing", async () => {
    vi.mocked(prepareImage).mockResolvedValue(null);
    db.seed("decks", deckRow("deck", "French"));
    await choose("노트 꾸미기");
    const sheet = within(screen.getByRole("dialog", { name: "노트 꾸미기" }));
    await userEvent.upload(
      sheet.getByLabelText("앨범에서 고르기"),
      new File([new Uint8Array([1])], "photo.heic", { type: "image/heic" }),
    );
    expect(await sheet.findByRole("alert")).toHaveTextContent(
      "사진을 불러오지 못했어요. 다시 시도해 주세요.",
    );
    expect(sheet.queryByRole("button", { name: "사진 삭제" })).not.toBeInTheDocument();
  });

  it("starts 노트 꾸미기 on the stored photo with the icon and colour folded, which 사진 삭제 removes from the preview and the note, the icon kept", async () => {
    const photo = uuidOf("photo");
    db.seed("decks", { ...deckRow("deck", "French"), image_media_id: photo, icon: "book" });
    db.rows.media.push({ user_id: testUser.id, id: photo });
    storage.seed(`${testUser.id}/${photo}`);
    await choose("노트 꾸미기", {
      deck: { ...french, icon: "book", imageUrl: "https://signed/photo" },
    });
    const dialog = screen.getByRole("dialog", { name: "노트 꾸미기" });
    const sheet = within(dialog);
    expect(dialog.querySelector("[style*='background-image']")).toHaveStyle({
      backgroundImage: 'url("https://signed/photo")',
    });
    // A photo covers the icon and the colour, so they fold; another photo is offered instead.
    expect(sheet.queryByRole("radio", { name: "책" })).not.toBeInTheDocument();
    expect(sheet.queryByRole("group", { name: "색" })).not.toBeInTheDocument();
    expect(sheet.getByLabelText("다른 사진")).toBeInTheDocument();
    expect(sheet.queryByLabelText("사진 찍기")).not.toBeInTheDocument();
    await userEvent.click(sheet.getByRole("button", { name: "사진 삭제" }));
    expect(dialog.querySelector("[style*='background-image']")).toBeNull();
    expect(sheet.getByRole("radio", { name: "책" })).toBeChecked();
    expect(sheet.getByLabelText("사진 찍기")).toBeInTheDocument();
    await userEvent.click(sheet.getByRole("button", { name: "저장" }));
    await waitFor(() => {
      expect(db.rows.decks[0]).toMatchObject({ image_media_id: null });
    });
    expect(storage.objects.size).toBe(0);
  });

  it("asks for a display name the first time, and publishes once the agreement is checked, saying so", async () => {
    db.seed("decks", deckRow("deck", "French"));
    await choose("노트 공개");
    const sheet = within(screen.getByRole("dialog", { name: '"French" 공개' }));
    expect(
      sheet.getByText("공개한 노트에 이 이름이 표시돼요. 이메일은 표시되지 않아요."),
    ).toBeInTheDocument();
    const publish = sheet.getByRole("button", { name: "공개" });
    expect(publish).toBeDisabled();
    await userEvent.click(
      sheet.getByRole("checkbox", {
        name: "부적절하거나 저작권을 침해하는 내용은 공개하지 않을게요",
      }),
    );
    await userEvent.type(sheet.getByRole("textbox", { name: "공개 이름" }), "가");
    await userEvent.click(publish);
    expect(sheet.getByText("2~20자로 입력해 주세요")).toBeInTheDocument();
    expect(db.rows.decks[0]).toMatchObject({ visibility: "private" });

    await userEvent.type(sheet.getByRole("textbox", { name: "공개 이름" }), "람");
    await userEvent.type(sheet.getByRole("textbox", { name: "설명 (선택)" }), "토익 단어");
    await userEvent.click(publish);
    expect(await screen.findByRole("status")).toHaveTextContent("노트를 공개했어요");
    expect(db.rows.decks[0]).toMatchObject({ visibility: "public", description: "토익 단어" });
    expect(db.rows.profiles).toEqual([expect.objectContaining({ display_name: "가람" })]);
  });

  it("asks for no name once the user has one, against a user with none", async () => {
    db.seed("decks", deckRow("deck", "French"));
    await choose("노트 공개", { displayName: { name: "가람" } });
    const sheet = within(screen.getByRole("dialog", { name: '"French" 공개' }));
    expect(sheet.queryByRole("textbox", { name: "공개 이름" })).not.toBeInTheDocument();
    await userEvent.click(sheet.getByRole("checkbox"));
    await userEvent.click(sheet.getByRole("button", { name: "공개" }));
    expect(await screen.findByRole("status")).toHaveTextContent("노트를 공개했어요");
    expect(db.rows.profiles).toEqual([]);
  });

  it("says a note publish-note has not made public is not yet, keeps the sheet open and the snack bar silent, against one it made public", async () => {
    db.seed("decks", deckRow("deck", "French"));
    publishNote.state = "checking";
    await choose("노트 공개", { displayName: { name: "가람" } });
    const sheet = within(screen.getByRole("dialog", { name: '"French" 공개' }));
    await userEvent.click(sheet.getByRole("checkbox"));
    await userEvent.click(sheet.getByRole("button", { name: "공개" }));
    expect(await sheet.findByText("노트를 확인하고 있어요. 확인이 끝나면 공개돼요.")).toBeVisible();
    expect(screen.queryByText("노트를 공개했어요")).not.toBeInTheDocument();
    expect(db.rows.decks[0]).toMatchObject({ visibility: "private" });
    await userEvent.click(sheet.getByRole("button", { name: "확인" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    publishNote.state = "public";
    await userEvent.click(screen.getByRole("button", { name: "노트 설정" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "노트 공개" }));
    const again = within(screen.getByRole("dialog", { name: '"French" 공개' }));
    await userEvent.click(again.getByRole("checkbox"));
    await userEvent.click(again.getByRole("button", { name: "공개" }));
    expect(await screen.findByRole("status")).toHaveTextContent("노트를 공개했어요");
    expect(db.rows.decks[0]).toMatchObject({ visibility: "public" });
  });

  it("shows why a refused note was refused when its sheet opens, none for a note never refused", async () => {
    db.seed("decks", { ...deckRow("deck", "French"), publication: "refused" });
    db.refusals.set(uuidOf("deck"), {
      refusal: "rules",
      findings: [{ card_id: "c", where: "front", block: 0, category: "phone", start: 0, end: 4 }],
    });
    await choose("노트 공개", {
      deck: { ...french, screening: "refused" },
      displayName: { name: "가람" },
    });
    const sheet = within(screen.getByRole("dialog", { name: '"French" 공개' }));
    expect(await sheet.findByText("전화번호가 들어 있어서 공개할 수 없어요.")).toBeVisible();
    cleanup();

    await choose("노트 공개", { displayName: { name: "가람" } });
    const plain = within(screen.getByRole("dialog", { name: '"French" 공개' }));
    expect(plain.queryByText(/공개할 수 없어요/)).not.toBeInTheDocument();
    expect(db.requests.filter((request) => request === "POST rpc/my_deck_screening")).toHaveLength(
      1,
    );
  });

  it("offers 비공개로 전환 for a note being checked, against one refused", async () => {
    db.seed("decks", {
      ...deckRow("deck", "French"),
      publication: "checking",
      visibility: "public",
    });
    await render(
      () => (
        <NoteSettings
          deck={{ ...french, screening: "checking" }}
          cardCount={2}
          displayName={{ name: "가람" }}
          cards={[]}
        />
      ),
      {},
    );
    await userEvent.click(screen.getByRole("button", { name: "노트 설정" }));
    expect(screen.getByRole("menuitem", { name: "비공개로 전환" })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: "노트 공개" })).not.toBeInTheDocument();
    cleanup();
    await choose("노트 공개", { deck: { ...french, screening: "refused" } });
    expect(screen.queryByRole("menuitem", { name: "비공개로 전환" })).not.toBeInTheDocument();
  });

  it("makes a published note private at once from 비공개로 전환, saying so", async () => {
    db.seed("decks", deckRow("deck", "French", false, "public"));
    await choose("비공개로 전환", { deck: { ...french, public: true } });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByRole("status")).toHaveTextContent("노트를 비공개로 전환했어요");
    expect(db.rows.decks[0]).toMatchObject({ visibility: "private" });
  });

  it("asks before deleting, naming the note and its cards, keeps it on 취소, and opens the 노트 page once deleted", async () => {
    db.seed("decks", deckRow("deck", "French"));
    db.seed("cards", cardRow("a", "deck", "a"), cardRow("b", "deck", "b"));
    await choose("노트 삭제");
    const question = screen.getByRole("dialog", { name: '"French" 노트를 삭제할까요?' });
    expect(question).toHaveTextContent("카드 2장도 함께 삭제돼요.");
    const buttons = within(question).getAllByRole("button");
    expect(
      buttons.map((button) => button.getAttribute("aria-label") ?? button.textContent),
    ).toEqual(["닫기", "취소", "삭제"]);
    expect(buttons.at(-1)).toHaveClass("bg-dont-know-text", "text-on-dont-know-text");
    await userEvent.click(within(question).getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(db.rows.decks[0]).toMatchObject({ deleted_at: null });

    await userEvent.click(screen.getByRole("button", { name: "노트 설정" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "노트 삭제" }));
    await userEvent.click(
      within(screen.getByRole("dialog", { name: '"French" 노트를 삭제할까요?' })).getByRole(
        "button",
        { name: "삭제" },
      ),
    );
    await waitFor(() => {
      expect(testRouter.push).toHaveBeenCalledWith("/decks");
    });
    expect(db.rows.decks[0]?.deleted_at).not.toBeNull();
    expect(db.rows.cards.every((row) => row.deleted_at !== null)).toBe(true);
  });

  it("says a note with no card holds none in the question", async () => {
    db.seed("decks", deckRow("deck", "French"));
    await choose("노트 삭제", { cardCount: 0 });
    expect(screen.getByRole("dialog", { name: '"French" 노트를 삭제할까요?' })).toHaveTextContent(
      "이 노트에는 카드가 없어요.",
    );
  });

  it("downloads the cards as Anki's plain text from Anki로 내보내기 and says what it wrote", async () => {
    const stored = (...cells: unknown[]) => {
      const content = parseCardContent({
        front: cells,
        back: [],
        template: "free",
        templateVersion: 2,
      });
      if (!content) throw new Error("the cells did not parse");
      return { id: "c" as CardId, deckId: french.id, createdAt: 0, ...content };
    };
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    const written: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      written.push(blob as Blob);
      return "blob:picked";
    });
    const named: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      named.push(this.download);
    });
    const photo = {
      type: "image",
      v: 2,
      id: "p",
      payload: { media: "m", width: 1, height: 1, boxes: [], side: "front" },
    };
    await choose("Anki로 내보내기", {
      cards: [
        stored({ type: "text", v: 3, id: "t", payload: { front: "**a**", back: "b" } }),
        stored(photo),
      ],
    });

    expect(await written[0]?.text()).toContain("Basic\tFrench\t<b>a</b>\tb\n");
    expect(named).toEqual(["French.txt"]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "카드 1장을 내보냈어요. 1장은 글이 없어 뺐어요",
    );
  });

  it("offers no export for a note with no card", async () => {
    await render(
      () => <NoteSettings deck={french} cardCount={0} displayName={{ name: null }} />,
      {},
    );
    await userEvent.click(screen.getByRole("button", { name: "노트 설정" }));

    expect(screen.getByRole("menuitem", { name: "노트 삭제" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Anki로 내보내기" })).not.toBeInTheDocument();
  });
});
