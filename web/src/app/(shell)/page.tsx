import type { Metadata, Viewport } from "next";
import { Suspense } from "react";

import { StudyStateRead } from "@/features/study";

import { Today } from "./_components/today";
import { TodaySkeleton } from "./_components/today-skeleton";

export const metadata: Metadata = { title: "홈 · 알아몰라" };

/**
 * Below 1024 px 홈's hero runs up behind the browser's top bar and the status bar (ADR 0188): the
 * page covers the screen, the hero keeping its words in the safe area, and the bar takes the
 * hero's colour, `hero` in each theme; from 1024 px it keeps the ground's, as the root layout's.
 */
export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(width < 1024px) and (prefers-color-scheme: light)", color: "#2547D0" },
    { media: "(width < 1024px) and (prefers-color-scheme: dark)", color: "#1A2F78" },
    { media: "(prefers-color-scheme: light)", color: "#EEF3FF" },
    { media: "(prefers-color-scheme: dark)", color: "#111A2E" },
  ],
};

/** 홈: today on the hero, and the notes under it (ADR 0150). */
export default function TodayPage() {
  return (
    <Suspense fallback={<TodaySkeleton />}>
      <StudyStateRead>
        <Today />
      </StudyStateRead>
    </Suspense>
  );
}
