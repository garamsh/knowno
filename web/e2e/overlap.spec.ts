import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { overlaps } from "./overlap";

test("the overlap check names each control drawn over another or clipped, and only what an open modal holds", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent(readFileSync(new URL("fixtures/overlap.html", import.meta.url), "utf8"));

  // The controls beside each case, with room for their edges or scrolled away, are not named.
  expect(await overlaps(page)).toEqual([
    'BUTTON "지정" overlaps BUTTON "무료로 되돌리기"',
    'A "카드" overlaps A "다음 카드"',
    'SPAN "‹" overlaps A "1"',
    'BUTTON "이용 정지" clipped by DIV "이용 정지"',
    'A "사용자" clipped by NAV "사용자"',
  ]);

  // Under an open modal, the page's overlaps are not looked at; the modal's own controls are.
  await page.evaluate(() => {
    document.querySelector("dialog")?.showModal();
  });
  expect(await overlaps(page)).toEqual([]);
  await page.evaluate(() => {
    const dialog = document.querySelector("dialog");
    dialog?.insertAdjacentHTML(
      "beforeend",
      '<button style="display: flex; margin-top: -30px">지정</button>',
    );
  });
  expect(await overlaps(page)).toEqual(['BUTTON "닫기" overlaps BUTTON "지정"']);
});
