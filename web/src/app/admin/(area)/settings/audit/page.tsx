import { Suspense } from "react";

import { AdminSkeleton } from "../../_components/admin-skeleton";
import { AuditContent } from "../../_components/content";

/** 설정, 작업 기록: the latest admin writes. */
export default function Page() {
  return (
    <>
      <h1 className="text-display">관리자</h1>
      <Suspense fallback={<AdminSkeleton />}>
        <AuditContent />
      </Suspense>
    </>
  );
}
