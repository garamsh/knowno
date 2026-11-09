import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { render } from "@/testing/render";
import { typeSizesOf } from "@/testing/type-sizes";

import PrivacyPage from "../(legal)/privacy/page";
import TermsPage from "../(legal)/terms/page";

/**
 * The headings issue #86 requires of each document, in the order they appear, and the date each
 * takes effect, which a change to that document moves (issue #373 moved the terms').
 */
const documents = [
  {
    name: "the privacy policy",
    page: PrivacyPage,
    title: "개인정보 처리방침",
    effectiveDate: "2026년 11월 17일",
    effectiveSentence: "이 개인정보 처리방침은 2026년 11월 17일부터 시행해요.",
    headings: [
      "수집하는 개인정보 항목과 수집 방법",
      "개인정보의 이용 목적",
      "보유 기간과 파기",
      "개인정보의 제3자 제공",
      "개인정보 처리의 위탁",
      "개인정보의 국외 이전",
      "이용자의 권리와 행사 방법",
      "자동으로 수집되는 정보와 쿠키",
      "개인정보의 안전성 확보 조치",
      "개인정보 보호 문의처",
      "시행일과 변경",
    ],
  },
  {
    name: "the terms of service",
    page: TermsPage,
    title: "이용약관",
    effectiveDate: "2026년 11월 3일",
    effectiveSentence: "이 약관은 2026년 11월 3일부터 시행해요.",
    headings: [
      "서비스",
      "계정과 로그인",
      "이용자의 콘텐츠와 이용 허락",
      "공개 공유, 신고와 차단, 금지 콘텐츠",
      "AI로 만든 카드",
      "서비스의 변경과 중단",
      "계정 삭제",
      "면책과 책임의 제한",
      "준거법과 관할",
      "문의처",
      "시행일",
    ],
  },
] as const;

describe.each(documents)("$name", ({ page, title, effectiveDate, effectiveSentence, headings }) => {
  it("is titled, states its effective date, and names the contact", async () => {
    await render(page, {});

    expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByText(`시행일 ${effectiveDate}`)).toBeInTheDocument();
    expect(screen.getByText(effectiveSentence)).toBeInTheDocument();
    for (const link of screen.getAllByRole("link", { name: "sauce@garam.sh" })) {
      expect(link).toHaveAttribute("href", "mailto:sauce@garam.sh");
    }
    expect(screen.getAllByRole("link", { name: "sauce@garam.sh" }).length).toBeGreaterThan(0);
  });

  it("draws in three sizes, the title, the body and the caption, its section headings in the body's", async () => {
    await render(page, {});

    expect(screen.getAllByRole("heading", { level: 2 }).length).toBeGreaterThan(0);
    expect(typeSizesOf(document.body)).toEqual([13, 16, 26]);
  });

  it("carries every required section, each a heading its table of contents links to", async () => {
    await render(page, {});

    const sections = screen
      .getAllByRole("heading", { level: 2 })
      .filter((heading) => heading.id !== "toc");
    expect(sections.map((heading) => heading.textContent)).toEqual(headings);

    const toc = within(screen.getByRole("navigation", { name: "목차" }));
    for (const heading of sections) {
      expect(toc.getByRole("link", { name: heading.textContent })).toHaveAttribute(
        "href",
        `#${heading.id}`,
      );
    }
  });
});

describe("the terms of service", () => {
  it("states that each plan limits photos by the month or the day, and 맥스's fair-use cap of 1,000 a day", async () => {
    await render(TermsPage, {});

    const ai = within(screen.getByRole("region", { name: "AI로 만든 카드" }));
    expect(
      ai.getByText(
        "사진으로 카드를 만드는 것은 요금제마다 쓸 수 있는 사진 수가 정해져 있고, 요금제에 따라 한 달 또는 하루 단위로 세요(한국 시간 기준). 맥스 요금제는 사진 수에 제한이 없지만, 공정 이용을 위해 하루 1,000장까지 쓸 수 있어요.",
      ),
    ).toBeInTheDocument();
  });
});

describe("the privacy policy", () => {
  it("says a note is checked automatically before it is public, and that the operator may read it", async () => {
    await render(PrivacyPage, {});

    const sharing = within(screen.getByRole("region", { name: "개인정보의 제3자 제공" }));
    expect(
      sharing.getByText(
        "공개하려는 노트는 다른 이용자에게 보이기 전에 자동으로 검사해요. 이름, 설명, 카드의 내용을 금칙어, 연락처와 링크, 자동 판별로 살펴보고, 걸린 노트는 공개되지 않거나 운영자가 확인할 때까지 기다려요. 운영자는 확인하려고 그 노트의 내용을 볼 수 있어요.",
      ),
    ).toBeInTheDocument();
  });
});
