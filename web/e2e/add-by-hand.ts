import type { Page } from "@playwright/test";

import { untilReacted } from "./until-reacted";

/**
 * Picks "직접 추가" from a page's ⋯ (#722): on a note, 노트 설정, which opens the 카드 추가 sheet;
 * on the 노트 page, 노트 메뉴, which opens 새 노트. It acts again only while no dialog is open, as
 * `untilReacted` does, and leaves the menu open for the item before it picks it.
 */
export async function addByHand(page: Page, menu: "노트 설정" | "노트 메뉴" = "노트 설정") {
  const item = page.getByRole("menuitem", { name: "직접 추가", exact: true });
  await untilReacted(
    async () => {
      if (!(await item.isVisible()))
        await page.getByRole("button", { name: menu, exact: true }).click();
      await item.click();
    },
    () => page.getByRole("dialog").isVisible(),
  );
}
