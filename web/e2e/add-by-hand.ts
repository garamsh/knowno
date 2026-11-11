import type { Page } from "@playwright/test";

import { untilReacted } from "./until-reacted";

/**
 * Presses the header's add button (#925): on a note, 카드 추가, which opens its sheet; on the 노트
 * page, 새 노트. The `menu` names are the page's, kept so a spec reads as it did before the
 * buttons left the ⋯ menus. It acts again only while no dialog is open, as `untilReacted` does.
 */
export async function addByHand(page: Page, menu: "노트 설정" | "노트 메뉴" = "노트 설정") {
  const button = page.getByRole("button", {
    name: menu === "노트 설정" ? "카드 추가" : "새 노트",
    exact: true,
  });
  await untilReacted(
    () => button.click(),
    () => page.getByRole("dialog").isVisible(),
  );
}
