import type { Metadata } from "next";
import { Suspense } from "react";

import { StudyFreshness } from "@/features/study";

import { Today } from "./_components/today";
import { TodaySkeleton } from "./_components/today-skeleton";

export const metadata: Metadata = { title: "홈 · 알아몰라" };

/** 홈: today on the hero, and the notes under it (ADR 0150). */
export default function TodayPage() {
  return (
    <>
      <StudyFreshness />
      <Suspense fallback={<TodaySkeleton />}>
        <Today />
      </Suspense>
    </>
  );
}
