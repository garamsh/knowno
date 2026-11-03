import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton, SkeletonLine } from "@/design/skeleton";
import { StudyFreshness } from "@/features/study";

import { Notes } from "./_components/notes";

export const metadata: Metadata = { title: "노트 · 알아몰라" };

/** 노트: every note under its search, and 새 노트 (ADR 0165). */
export default function NotesPage() {
  return (
    <>
      <StudyFreshness />
      <Suspense
        fallback={
          <Skeleton status="노트를 불러오는 중이에요." className="flex flex-col gap-3">
            <SkeletonLine text="text-deck-title" width="w-20" />
            <span className="h-search rounded-field bg-surface" />
            <span className="h-19 rounded-row bg-surface" />
            <span className="h-19 rounded-row bg-surface" />
          </Skeleton>
        }
      >
        <Notes />
      </Suspense>
    </>
  );
}
