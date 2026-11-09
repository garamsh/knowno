import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import ReplyMarkdown from "../components/reply-markdown";

const rich = [
  "# 제목",
  "",
  "**굵게** 그리고 ~~지움~~",
  "",
  "- 하나",
  "  - 안쪽",
  "- 둘",
  "",
  "```ts",
  "const a = 1;",
  "```",
  "",
  "| 단어 | 뜻 |",
  "| --- | --- |",
  "| apple | 사과 |",
  "",
  "[문서](https://example.com/doc)",
].join("\n");

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.theme;
});

describe("말랑이's reply as Markdown", () => {
  it("draws a heading, bold, a nested list, a code block, a table and a link, and plain text as it is", () => {
    const { container } = render(<ReplyMarkdown text={rich} />);
    expect(screen.getByRole("heading", { name: "제목" })).toBeInTheDocument();
    expect(screen.getByText("굵게").tagName).toBe("STRONG");
    expect(screen.getByText("지움").tagName).toBe("DEL");
    const outer = screen.getByText("둘").closest("ul");
    const inner = screen.getByText("안쪽").closest("ul");
    if (!outer || !inner) throw new Error("the lists were not drawn");
    expect(within(outer).getAllByRole("listitem")).toHaveLength(3);
    expect(within(inner).getByRole("listitem")).toHaveTextContent("안쪽");
    expect(outer).toContainElement(inner);
    expect(screen.getByText("const a = 1;").closest("pre")).not.toBeNull();
    // The header keeps its semantics.
    expect(screen.getByRole("columnheader", { name: "단어" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "사과" })).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "문서" });
    expect(link).toHaveAttribute("href", "https://example.com/doc");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    // No mark is left showing.
    expect(container.textContent).not.toMatch(/\*\*|~~|```|\| ---/);

    cleanup();
    const plain = render(<ReplyMarkdown text="안녕하세요. 오늘은 무엇을 외워 볼까요?" />);
    expect(plain.container.textContent).toBe("안녕하세요. 오늘은 무엇을 외워 볼까요?");
    expect(plain.container.querySelector("strong, a, table, ul, ol, pre, img")).toBeNull();
  });

  it("shows an image as its alt text and never fetches it, where a link is kept", () => {
    const { container } = render(
      <ReplyMarkdown
        text={"![고양이 사진](https://example.com/cat.png) 그리고 [링크](https://example.com)"}
      />,
    );
    expect(screen.getByText("고양이 사진")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toContain("cat.png");
    expect(screen.getByRole("link", { name: "링크" })).toBeInTheDocument();
  });

  it("shows raw HTML as text, where Markdown's own marks are drawn", () => {
    const { container } = render(
      <ReplyMarkdown
        text={'<b>굵은 척</b> <script>alert(1)</script> <img src="x" onerror="y"> **진짜**'}
      />,
    );
    expect(container.textContent).toContain("<b>굵은 척</b>");
    expect(container.textContent).toContain("<script>alert(1)</script>");
    expect(container.querySelector("b, script, img")).toBeNull();
    expect(screen.getByText("진짜").tagName).toBe("STRONG");
  });

  it("opens http, https and mailto links and shows any other scheme as text", () => {
    render(
      <ReplyMarkdown
        text={[
          "[열기](https://example.com)",
          "[편지](mailto:a@example.com)",
          "[위험](javascript:alert(1))",
          "[파일](file:///etc/passwd)",
          "[상대](/assistant)",
        ].join("\n\n")}
      />,
    );
    expect(screen.getByRole("link", { name: "열기" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "편지" })).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(2);
    for (const word of ["위험", "파일", "상대"]) {
      expect(screen.getByText(word)).toBeInTheDocument();
    }
  });

  it("scrolls a table and a code block sideways inside the reply, reachable from the keyboard", () => {
    render(<ReplyMarkdown text={rich} />);
    const table = screen.getByRole("region", { name: "표" });
    expect(table).toHaveClass("overflow-x-auto");
    expect(table).toHaveAttribute("tabindex", "0");
    expect(within(table).getByRole("table")).toBeInTheDocument();
    const pre = screen.getByText("const a = 1;").closest("pre");
    expect(pre).toHaveClass("overflow-x-auto");
    expect(pre).toHaveAttribute("tabindex", "0");
  });

  it("reads every prefix of a reply being streamed without failing, an unclosed mark showing as typed", () => {
    for (let end = 0; end <= rich.length; end += 1) {
      const { unmount } = render(<ReplyMarkdown text={rich.slice(0, end)} />);
      unmount();
    }
    render(<ReplyMarkdown text="**굵게 아직" />);
    expect(screen.getByText("**굵게 아직")).toBeInTheDocument();
    cleanup();
    render(<ReplyMarkdown text={"```ts\nconst a"} />);
    expect(screen.getByText("const a").closest("pre")).not.toBeNull();
    cleanup();
    render(<ReplyMarkdown text={"| 단어 | 뜻 |\n| --- |"} />);
    expect(screen.getByText(/단어/)).toBeInTheDocument();
  });

  it("draws the same markup in both themes, its colours the tokens the theme sets", () => {
    const light = render(<ReplyMarkdown text={rich} />).container.innerHTML;
    cleanup();
    document.documentElement.dataset.theme = "dark";
    const dark = render(<ReplyMarkdown text={rich} />).container.innerHTML;
    expect(dark).toBe(light);
    expect(light).not.toMatch(
      /style="[^"]*(color|background)|#[0-9a-f]{3,6}|(bg|text|border)-(white|black|[a-z]+-\d{2,3})\b/,
    );
  });
});
