import { Suspense } from "react";

import { AdminSkeleton } from "../_components/admin-skeleton";
import { PlansContent } from "../_components/content";

/** 설정, 요금제: each plan's versions and its model. */
export default function Page() {
  return (
    <>
      <h1 className="text-display">설정</h1>
      <Suspense fallback={<AdminSkeleton />}>
        <PlansContent />
      </Suspense>
    </>
  );
}
