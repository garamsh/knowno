import { Suspense } from "react";

import { AdminSkeleton } from "../_components/admin-skeleton";
import { AiContent } from "../_components/content";

/** 사진 AI: the active and test prompts, the trial, and each version's results. */
export default function Page() {
  return (
    <>
      <h1 className="text-display">AI</h1>
      <Suspense fallback={<AdminSkeleton />}>
        <AiContent />
      </Suspense>
    </>
  );
}
