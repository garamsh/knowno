import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Presses the header's add button (#925): on a note, which of "노트 설정" opens 카드 추가's
 * sheet; on the 노트 page, which of "노트 메뉴" opens 새 노트. The names are the page's, kept so a
 * test reads as it did before the buttons left the ⋯ menus.
 */
export async function addByHand(menu: "노트 설정" | "노트 메뉴" = "노트 설정") {
  await userEvent.click(
    screen.getByRole("button", { name: menu === "노트 설정" ? "카드 추가" : "새 노트" }),
  );
}
