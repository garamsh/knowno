import { Suspense } from "react";

import { AdminSkeleton } from "./_components/admin-skeleton";
import { TodoContent } from "./_components/content";

/** 처리할 일: what waits on an operator, then the last 7 days against the 7 before (ADR 0155). */
export default function Page() {
  return (
    <>
      <h1 className="text-display">처리할 일</h1>
      <Suspense fallback={<AdminSkeleton />}>
        <TodoContent />
      </Suspense>
    </>
  );
}
