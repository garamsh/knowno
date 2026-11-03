import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { layOutLines, zoomOf } from "@/testing/line-widths";

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
    ["/", "홈"],
    ["/decks", "노트"],
    ["/decks/d-fr", "노트"],
    ["/record", "기록"],
    ["/account", "none"],
  ])(
    "on %s hold 기록, 홈 and 노트 in that order, %s current, in the side menu and the tab bar, and no 설정",
    (at, current) => {
      path = at;
      render(
        <>
          <SideMenu />
          <TabBar />
        </>,
      );
      const [side, tabs] = screen.getAllByRole("navigation", { name: "주 메뉴" });
      const pages = ["기록 → /record", "홈 → /", "노트 → /decks"].map((link) =>
        link.startsWith(current) ? `${link} (current)` : link,
      );

      expect(links(side ?? document.body)).toEqual(["알아몰라, 홈 → /", ...pages]);
      expect(links(tabs ?? document.body)).toEqual(pages);
    },
  );

  it("draw the current page in the accent and the others in ink-2, on both menus, the side menu's over a tinted pill", () => {
    path = "/decks/d-fr";
    render(
      <>
        <SideMenu />
        <TabBar />
      </>,
    );
    const menus = screen.getAllByRole("navigation", { name: "주 메뉴" });
    expect(menus).toHaveLength(2);
    for (const menu of menus) {
      const current = within(menu).getByRole("link", { name: "노트" });
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
    expect(pill(side, "노트")).toHaveClass("bg-brand-tint");
    expect(pill(side, "기록")).not.toHaveClass("bg-brand-tint");
    // The tab bar's tabs are their names alone.
    expect(tabs.querySelector("svg")).toBeNull();
  });

  it("hold the profile button at the side menu's foot, after its pages, and none in the tab bar", () => {
    path = "/";
    render(
      <>
        <SideMenu profile={<a href="/account">설정</a>} />
        <TabBar />
      </>,
    );
    const [side, tabs] = screen.getAllByRole("navigation", { name: "주 메뉴" });
    if (!side || !tabs) throw new Error("the two menus are drawn");

    expect(links(side)).toEqual([
      "알아몰라, 홈 → /",
      "기록 → /record",
      "홈 → / (current)",
      "노트 → /decks",
      "설정 → /account",
    ]);
    expect(within(side).getByRole("link", { name: "설정" }).parentElement).toHaveClass("mt-auto");
    expect(within(tabs).queryByRole("link", { name: "설정" })).not.toBeInTheDocument();
  });

  it("show the side menu from 1024 px wide and the tab bar below it", () => {
    path = "/";
    render(
      <>
        <SideMenu />
        <TabBar />
      </>,
    );
    const [side, tabs] = screen.getAllByRole("navigation", { name: "주 메뉴" });

    // The side menu shows and hides with the column that draws its surface down the page.
    expect(side?.parentElement).toHaveClass("hidden", "lg:block");
    expect(tabs).toHaveClass("lg:hidden");
    expect(tabs).not.toHaveClass("hidden");
  });

  it("keep each tab's name on one line, shrunk to its tab only where wider", () => {
    // Each name is two characters, 40 px: a 30 px tab shrinks it, a 40 px one holds it.
    for (const [tab, zoom] of [
      [30, 0.75],
      [40, 1],
    ] as const) {
      const restore = layOutLines(tab);
      render(<TabBar />);
      const tabs = screen.getByRole("navigation", { name: "주 메뉴" });
      for (const name of ["기록", "노트"]) {
        expect(zoomOf(within(tabs).getByText(name)), `${name} in a ${String(tab)} px tab`).toBe(
          zoom,
        );
      }
      restore();
      cleanup();
    }
  });
});
