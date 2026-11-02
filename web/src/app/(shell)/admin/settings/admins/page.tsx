import { Suspense } from "react";

import { AdminSkeleton } from "../../_components/admin-skeleton";
import { AdminsContent } from "../../_components/content";

/** 설정, 관리자: the admins, with granting and revoking. */
export default function Page() {
  return (
    <>
      <h1 className="text-display">설정</h1>
      <Suspense fallback={<AdminSkeleton />}>
        <AdminsContent />
      </Suspense>
    </>
  );
}
