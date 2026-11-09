import type { Metadata } from "next";
import { Suspense } from "react";

import { ScreenSkeleton } from "@/design/screen-skeleton";
import { Skeleton, SkeletonLine } from "@/design/skeleton";
import { StudyStateRead } from "@/features/study";

import { Notes } from "./_components/notes";

export const metadata: Metadata = { title: "노트 · 알아몰라" };

/** 노트: every note under its search, and 새 노트 (ADR 0165). */
export default function NotesPage() {
  return (
    <Suspense
      fallback={
        <Skeleton status="노트를 불러오는 중이에요." className="flex flex-1 flex-col">
          <ScreenSkeleton
            placeholder
            title={<SkeletonLine text="text-deck-title" width="w-20" />}
            topLevel
            actions={<span className="size-tap-target shrink-0 rounded-chip bg-surface" />}
            search={<span className="block h-search rounded-field bg-surface" />}
          >
            <div className="flex flex-col gap-3">
              <span className="h-19 rounded-row bg-surface" />
              <span className="h-19 rounded-row bg-surface" />
            </div>
          </ScreenSkeleton>
        </Skeleton>
      }
    >
      <StudyStateRead>
        <Notes />
      </StudyStateRead>
    </Suspense>
  );
}
