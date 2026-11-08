import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { deckRow, uuidOf } from "@/testing/library";
import { FakePostgrest } from "@/testing/mocks/postgrest";
import { server } from "@/testing/mocks/server";
import { setRequestCookies } from "@/testing/next-headers";
import { addByHand } from "@/testing/add-by-hand";
import { render } from "@/testing/render";
import { testRouter } from "@/testing/router";
import { signedInCookies } from "@/testing/session";

import { NoteSettings } from "../components/note-settings";
import { NotesMenu } from "../components/notes-menu";
import { parseDeckId } from "../library";

vi.mock("next/headers", () => import("@/testing/next-headers"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const deckId = parseDeckId(uuidOf("deck"));
if (!deckId) throw new Error("fixture ids");
const deck = { id: deckId, name: "단어장", public: false };
let db: FakePostgrest;
beforeEach(async () => {
  db = new FakePostgrest();
  server.use(...db.handlers);
  setRequestCookies(await signedInCookies());
  db.rows.decks.push(deckRow("deck", "단어장"));
  testRouter.push.mockClear();
  // The page's own entry, which the history is back on once every authoring screen has closed.
  window.history.replaceState({ page: "deck" }, "");
});

/** Whether the history is on the page's own entry again, and not on one a dialog pushed. */
const onPageEntry = () => (window.history.state as { page?: string } | null)?.page === "deck";

/** Opens 새 카드 from the deck's "카드 추가" sheet, as a user does. */
async function newCard() {
  await render(() => <NoteSettings deck={deck} cardCount={0} displayName={{ name: null }} />, {});
  await addByHand();
  await userEvent.click(screen.getByRole("button", { name: "직접 입력" }));
  expect(screen.getByRole("dialog", { name: "새 카드" })).toBeInTheDocument();
  expect(onPageEntry()).toBe(false);
}

describe("the browser's back on an authoring screen", () => {
  it("closes 새 카드 untouched, back on the page's own entry, with focus on 카드 추가", async () => {
    await newCard();
    // The 카드 추가 sheet's entry passed to the screen it led to, leaving none ahead to go
    // forward to, and one back leaves both.
    window.history.forward();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByRole("dialog", { name: "새 카드" })).toBeInTheDocument();
    window.history.back();

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(onPageEntry()).toBe(true);
    expect(screen.getByRole("button", { name: "노트 설정" })).toHaveFocus();
  });

  it("asks before leaving an edited card, and a back on the question keeps writing", async () => {
    await newCard();
    await userEvent.type(screen.getByRole("textbox", { name: "앞면" }), "사과");
    window.history.back();

    expect(
      await screen.findByRole("dialog", { name: "작성 중인 카드를 버릴까요?" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "새 카드" })).toBeInTheDocument();
    window.history.back();
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "작성 중인 카드를 버릴까요?" }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByRole("textbox", { name: "앞면" })).toHaveValue("사과");

    // The screen kept writing still holds its entry, so the next back asks again.
    window.history.back();
    expect(
      await screen.findByRole("dialog", { name: "작성 중인 카드를 버릴까요?" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "계속 쓰기" }));
    // Escape asks as the back does; "버리기" then leaves to the page's own entry.
    fireEvent(
      screen.getByRole("dialog", { name: "새 카드" }),
      new Event("cancel", { cancelable: true }),
    );
    await userEvent.click(screen.getByRole("button", { name: "버리기" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(onPageEntry()).toBe(true);
    });
  });

  it("closes the 칸 추가 sheet alone, leaving 새 카드 open on its own entry", async () => {
    await newCard();
    await userEvent.click(screen.getByRole("button", { name: "+ 칸 추가" }));
    expect(screen.getByRole("dialog", { name: "칸 추가" })).toBeInTheDocument();
    window.history.back();

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "칸 추가" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("dialog", { name: "새 카드" })).toBeInTheDocument();
    window.history.back();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(onPageEntry()).toBe(true);
  });

  it("leaves 새 노트's entry before opening the note it saved, as the phone pops it first", async () => {
    await render(() => <NotesMenu />, {});
    await addByHand("노트 메뉴");
    await userEvent.type(screen.getByRole("textbox", { name: "노트 이름" }), "토익");
    let entryAtPush: boolean | undefined;
    testRouter.push.mockImplementationOnce(() => {
      entryAtPush = onPageEntry();
    });
    await userEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => {
      expect(testRouter.push).toHaveBeenCalledOnce();
    });
    expect(entryAtPush).toBe(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
