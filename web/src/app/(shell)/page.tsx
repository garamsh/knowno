import type { Metadata, Viewport } from "next";
import { Suspense } from "react";

import { StudyStateRead } from "@/features/study";

import { Today } from "./_components/today";
import { TodaySkeleton } from "./_components/today-skeleton";

export const metadata: Metadata = { title: "홈 · 알아몰라" };

/**
 * 홈's sky runs up behind the status bar below 1024 px (ADR 0193): the page covers the screen, its
 * words and controls in the safe area; `SkyThemeColor` gives the browser's bar the sky's colour.
 */
export const viewport: Viewport = { viewportFit: "cover" };

/** 홈: one screen, the sky over the ground (ADR 0193). */
export default function TodayPage() {
  return (
    <Suspense fallback={<TodaySkeleton />}>
      <StudyStateRead>
        <Today />
      </StudyStateRead>
    </Suspense>
  );
}
