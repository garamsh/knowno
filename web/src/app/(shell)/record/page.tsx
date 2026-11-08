import type { Metadata } from "next";
import { Suspense } from "react";

import { EdgeAssistant } from "@/features/assistant";
import { StudyStateRead } from "@/features/study";

import { RecordContent } from "./_components/record";
import { RecordSkeleton } from "./_components/record-skeleton";

export const metadata: Metadata = { title: "기록 · 알아몰라" };

/**
 * 기록: the retention against its target, the recall bands, the mastered weeks and the study days,
 * and 말랑이 at the edge (#722).
 */
export default function RecordPage() {
  return (
    <>
      <h1 className="text-display">기록</h1>
      <Suspense fallback={<RecordSkeleton />}>
        <StudyStateRead>
          <RecordContent />
        </StudyStateRead>
      </Suspense>
      <EdgeAssistant />
    </>
  );
}
