import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Page from "../page";

// 처리할 일's content reads the server; only the page's own heading is under test here.
vi.mock("../_components/content", () => ({ TodoContent: () => null }));

describe("the admin area's first page", () => {
  it("is headed 처리할 일, the name the section menu gives it", () => {
    render(<Page />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveAccessibleName("처리할 일");
  });
});
