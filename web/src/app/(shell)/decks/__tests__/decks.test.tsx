import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import NotesPage, { metadata } from "../page";

describe("/decks", () => {
  it("is the 노트 page, titled 노트, no longer a redirect to 홈", () => {
    expect(metadata.title).toBe("노트 · 알아몰라");
    // A redirect throws before the page returns; the page shows its skeleton while it reads.
    render(NotesPage());
    expect(screen.getByRole("status")).toHaveTextContent("노트를 불러오는 중이에요.");
  });
});
