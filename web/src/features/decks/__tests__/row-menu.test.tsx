import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { RowMenu } from "../components/row-menu";

describe("a ⋯ menu", () => {
  it("keeps each item on one line, as the phone's menu, inside a dialog that breaks between words", async () => {
    render(
      <div className="break-keep">
        <RowMenu
          label="사진 메뉴"
          items={[
            { label: "다른 사진 고르기", pick: () => undefined },
            { label: "삭제", danger: true, pick: () => undefined },
          ]}
        />
      </div>,
    );
    await userEvent.click(screen.getByRole("button", { name: "사진 메뉴" }));
    // jsdom lays nothing out: the class is what keeps the line whole in a browser.
    for (const item of screen.getAllByRole("menuitem"))
      expect(item.className.split(" ")).toContain("whitespace-nowrap");
  });
});
