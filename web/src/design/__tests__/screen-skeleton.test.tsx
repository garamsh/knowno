import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ScreenSkeleton } from "../screen-skeleton";

const slot = (container: HTMLElement, name: string) =>
  container.querySelector<HTMLElement>(`[data-slot="${name}"]`);

describe("the screen skeleton", () => {
  it("draws a top-level screen's title and actions in one header, then the search, then the body", () => {
    const { container } = render(
      <ScreenSkeleton
        title="노트"
        topLevel
        actions={<button type="button">노트 메뉴</button>}
        search={<input type="search" aria-label="노트 검색" />}
      >
        <p>rows</p>
      </ScreenSkeleton>,
    );

    const header = slot(container, "header");
    expect(header).toContainElement(screen.getByRole("heading", { level: 1, name: "노트" }));
    expect(header).toContainElement(screen.getByRole("button", { name: "노트 메뉴" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveClass("text-deck-title");
    expect(slot(container, "search")).toContainElement(screen.getByRole("searchbox"));
    expect(slot(container, "body")).toHaveTextContent("rows");
    expect(
      [...container.querySelectorAll("[data-slot]")].map((el) => el.getAttribute("data-slot")),
    ).toEqual(["header", "search", "body"]);
  });

  it("puts a screen's actions in a bar above its name and clamps a name the user wrote to two lines", () => {
    const { container } = render(
      <ScreenSkeleton title="한국사" userTitle actions={<button type="button">노트 설정</button>}>
        <p>cards</p>
      </ScreenSkeleton>,
    );

    const header = slot(container, "header");
    const bar = within(header as HTMLElement).getByRole("button", { name: "노트 설정" })
      .parentElement as HTMLElement;
    const title = screen.getByRole("heading", { level: 1, name: "한국사" });
    expect(bar.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bar).toHaveClass("min-h-tap-target", "justify-end");
    expect(title).toHaveClass("text-deck-name", "line-clamp-2", "break-keep");
  });

  it("draws no bar and no search where the screen has neither", () => {
    const { container } = render(
      <ScreenSkeleton title="설정">
        <p>groups</p>
      </ScreenSkeleton>,
    );

    expect(slot(container, "search")).toBeNull();
    expect(slot(container, "header")?.children).toHaveLength(1);
    expect(slot(container, "body")).toHaveClass("gap-section-gap");
  });

  it("draws a placeholder's title without a heading", () => {
    render(
      <ScreenSkeleton title={<span>line</span>} placeholder>
        <p>rows</p>
      </ScreenSkeleton>,
    );

    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByText("line").parentElement).toHaveClass("text-deck-title");
  });
});
