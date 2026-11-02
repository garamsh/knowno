import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import ErrorPage from "../error";
import NotFound from "../not-found";

describe("the error page", () => {
  it("offers 다시 시도, which resets the segment, and 오늘로 가기 back to 오늘", async () => {
    const reset = vi.fn();
    render(<ErrorPage error={new Error("render failed")} reset={reset} />);

    expect(screen.getByRole("heading", { name: "문제가 생겼어요" })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "다시 시도" }));
    expect(reset).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "오늘로 가기" })).toHaveAttribute("href", "/");
  });
});

describe("the not-found page", () => {
  it("links 노트 목록 to the deck list it names", () => {
    render(<NotFound />);

    expect(screen.getByRole("link", { name: "노트 목록" })).toHaveAttribute("href", "/decks");
  });
});
