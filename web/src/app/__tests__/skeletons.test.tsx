import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { TodaySkeleton } from "../(shell)/_components/today-skeleton";
import { ProfileSkeleton } from "../(shell)/account/_components/profile-skeleton";
import { DeckSkeleton } from "../(shell)/decks/[id]/_components/deck-skeleton";
import { RecordSkeleton } from "../(shell)/record/_components/record-skeleton";
import { ConsentSkeleton } from "../oauth/consent/_components/consent-skeleton";
import { StudySkeleton } from "../study/_components/study-skeleton";

const skeletons: [string, ReactElement, string][] = [
  ["홈", <TodaySkeleton key="today" />, "오늘 할 카드를 불러오는 중이에요."],
  ["a deck's page", <DeckSkeleton key="deck" />, "노트를 불러오는 중이에요."],
  ["the study page", <StudySkeleton key="study" />, "카드를 불러오는 중이에요."],
  ["the settings page", <ProfileSkeleton key="account" />, "설정을 불러오는 중이에요."],
  ["the record page", <RecordSkeleton key="record" />, "기록을 불러오는 중이에요."],
  ["the consent page", <ConsentSkeleton key="consent" />, "연결 요청을 불러오는 중이에요."],
];

describe("a page's loading skeleton", () => {
  afterEach(cleanup);

  it.each(skeletons)(
    "on %s is busy, says what it waits for, and hides its placeholders from screen readers",
    (_, skeleton, sentence) => {
      const { container } = render(skeleton);

      const status = screen.getByRole("status");
      expect(status).toHaveTextContent(sentence);
      expect(status).toHaveClass("sr-only");
      const busy = status.closest('[aria-busy="true"]');
      expect(busy).not.toBeNull();
      // The placeholders are drawn and hidden: nothing else in the skeleton is read.
      const placeholders = busy?.querySelector('[aria-hidden="true"]');
      expect(placeholders?.childElementCount).toBeGreaterThan(0);
      expect(container.textContent.replace(/​/g, "")).toBe(sentence);
      // It pulses only where motion is welcome (globals.css' skeleton animation, motion-safe).
      expect(placeholders).toHaveClass("motion-safe:animate-skeleton");
      expect(placeholders?.className).not.toMatch(/(^|\s)animate-/);
    },
  );

  it("on 홈 gives the browser's bar the sky's colour while it shows, as 홈 does", () => {
    document.documentElement.style.setProperty("--color-hero", "#2547d0");
    const themeColor = () =>
      document.head.querySelector('meta[name="theme-color"]')?.getAttribute("content");

    const { unmount } = render(<TodaySkeleton />);
    expect(themeColor()).toBe("#2547d0");
    unmount();
    expect(themeColor()).toBeUndefined();
    document.documentElement.style.removeProperty("--color-hero");
  });
});
