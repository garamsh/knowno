import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SearchField } from "../search-field";

describe("the search over a list", () => {
  it("is one search field named and hinted by its label, inside its outline at the search height", () => {
    render(<SearchField label="노트 검색" name="q" defaultValue="단어" />);

    const field = screen.getByRole("searchbox", { name: "노트 검색" });
    expect(field).toHaveAttribute("placeholder", "노트 검색");
    expect(field).toHaveAttribute("name", "q");
    expect(field).toHaveValue("단어");
    expect(field.closest("label")).toHaveClass("h-search", "border-outline", "rounded-field");
  });
});
