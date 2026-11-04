import { Suspense } from "react";

import { AdminSkeleton } from "../_components/admin-skeleton";
import { AdminsContent } from "../_components/content";

/** 관리자: the admins, with granting and revoking, and the latest admin writes (ADR 0181). */
export default function Page() {
  return (
    <>
      <h1 className="text-display">관리자</h1>
      <Suspense fallback={<AdminSkeleton />}>
        <AdminsContent />
      </Suspense>
    </>
  );
}
