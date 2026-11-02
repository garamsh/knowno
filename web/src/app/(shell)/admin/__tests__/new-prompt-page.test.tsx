import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Page from "../ai/new/page";

// The form reads the server; only the page's own heading and line are under test here.
vi.mock("../_components/content", () => ({ NewPromptContent: () => null }));

describe("the new prompt version's page", () => {
  it("says that the fixed output contract is sent after every version", () => {
    render(<Page params={Promise.resolve({})} searchParams={Promise.resolve({})} />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveAccessibleName("새 버전");
    expect(
      screen.getByText(
        "모든 버전 뒤에는 함수에 고정된 출력 계약(카드의 필드와 규칙)이 함께 보내져요.",
      ),
    ).toBeInTheDocument();
  });
});
