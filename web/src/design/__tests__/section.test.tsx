import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Section } from "../section";

describe("the label over a group", () => {
  it("names its region by its label, a muted section heading, with its note under it", () => {
    render(
      <Section label="계정" note="로그인한 계정이에요.">
        <p>group</p>
      </Section>,
    );

    const region = screen.getByRole("region", { name: "계정" });
    const heading = screen.getByRole("heading", { level: 2, name: "계정" });
    expect(region).toContainElement(heading);
    expect(heading).toHaveClass("text-section", "text-muted");
    expect(region).toHaveTextContent(/^계정로그인한 계정이에요\.group$/);
  });

  it("takes the id a control inside it is labelled by", () => {
    render(
      <Section label="화면" id="display-section">
        <div role="radiogroup" aria-labelledby="display-section" />
      </Section>,
    );

    expect(screen.getByRole("radiogroup", { name: "화면" })).toBeInTheDocument();
  });
});
