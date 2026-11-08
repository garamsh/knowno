import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/** Picks "직접 추가" from the ⋯ named [menu]: the note page's 노트 설정, or the 노트 page's 노트 메뉴. */
export async function addByHand(menu: "노트 설정" | "노트 메뉴" = "노트 설정") {
  await userEvent.click(screen.getByRole("button", { name: menu }));
  await userEvent.click(screen.getByRole("menuitem", { name: "직접 추가" }));
}
