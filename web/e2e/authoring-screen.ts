import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Checks that [screen], an authoring flow open on [page], is the whole page at a phone's 390 px,
 * its last control at the foot, as the phone pushes a screen, and a dialog clear of the page's
 * edges at 1280 px (ADR 0158). It leaves the page at 390 px.
 */
export async function expectScreenAtWidths(page: Page, screen: Locator): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await screen.boundingBox(), "the whole page at 390 px").toEqual({
    x: 0,
    y: 0,
    width: 390,
    height: 844,
  });
  // The foot's actions, under the scrolling fields, end the screen: its gutter of 16 below them.
  const last = await screen.getByRole("button").last().boundingBox();
  if (!last) throw new Error("the screen draws its actions");
  expect(844 - (last.y + last.height), "the actions at the foot").toBeLessThanOrEqual(17);

  await page.setViewportSize({ width: 1280, height: 900 });
  const wide = await screen.boundingBox();
  if (!wide) throw new Error("the screen is drawn at 1280 px");
  expect(wide.width, "a dialog at 1280 px").toBeLessThanOrEqual(560);
  expect(wide.x).toBeGreaterThan(0);
  expect(wide.y).toBeGreaterThan(0);
  await page.setViewportSize({ width: 390, height: 844 });
}
