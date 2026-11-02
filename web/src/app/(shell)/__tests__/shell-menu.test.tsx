import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SideMenu, TabBar } from "../_components/shell-menu";

let path = "/";
vi.mock("next/navigation", () => ({ usePathname: () => path }));

/** Each link of [menu] as "name → href", the current page marked. */
function links(menu: HTMLElement) {
  return within(menu)
    .getAllByRole("link")
    .map(
      (link) =>
        `${link.getAttribute("aria-label") ?? link.textContent} → ${String(link.getAttribute("href"))}${link.getAttribute("aria-current") === "page" ? " (current)" : ""}`,
    );
}

describe("the shell's menus", () => {
  afterEach(cleanup);

  it.each([
    ["/", "오늘"],
    ["/decks", "덱"],
    ["/decks/d-fr", "덱"],
    ["/record", "기록"],
  ])("on %s mark %s as the current page, in the side menu and the tab bar", (at, current) => {
    path = at;
    render(
      <>
        <SideMenu account={<a href="/account">설정</a>} />
        <TabBar />
      </>,
    );
    const [side, tabs] = screen.getAllByRole("navigation", { name: "주 메뉴" });
    const pages = ["오늘 → /", "덱 → /decks", "기록 → /record"].map((link) =>
      link.startsWith(current) ? `${link} (current)` : link,
    );

    expect(links(side ?? document.body)).toEqual([
      "알아몰라, 오늘 → /",
      ...pages,
      "설정 → /account",
    ]);
    expect(links(tabs ?? document.body)).toEqual(pages);
  });

  it("draw the current page in the accent and the others in ink-2, on both menus, the side menu's over a tinted pill", () => {
    path = "/decks";
    render(
      <>
        <SideMenu account={null} />
        <TabBar />
      </>,
    );
    const menus = screen.getAllByRole("navigation", { name: "주 메뉴" });
    expect(menus).toHaveLength(2);
    for (const menu of menus) {
      const current = within(menu).getByRole("link", { name: "덱" });
      expect(current).toHaveClass("text-label", "text-accent");
      // Control: another page takes neither.
      const other = within(menu).getByRole("link", { name: "기록" });
      expect(other).toHaveClass("text-label", "text-ink-2");
      expect(other).not.toHaveClass("text-accent");
    }
    const [side, tabs] = menus;
    if (!side || !tabs) throw new Error("the two menus are checked above");
    const pill = (menu: HTMLElement, name: string) =>
      within(menu).getByRole("link", { name }).querySelector("svg")?.parentElement;
    expect(pill(side, "덱")).toHaveClass("bg-brand-tint");
    expect(pill(side, "기록")).not.toHaveClass("bg-brand-tint");
    // The tab bar's tabs are their names alone.
    expect(tabs.querySelector("svg")).toBeNull();
  });

  it("show the side menu from 1024 px wide and the tab bar below it", () => {
    path = "/";
    render(
      <>
        <SideMenu account={null} />
        <TabBar />
      </>,
    );
    const [side, tabs] = screen.getAllByRole("navigation", { name: "주 메뉴" });

    // The side menu shows and hides with the column that draws its surface down the page.
    expect(side?.parentElement).toHaveClass("hidden", "lg:block");
    expect(tabs).toHaveClass("lg:hidden");
    expect(tabs).not.toHaveClass("hidden");
  });
});
