import { Suspense } from "react";

import { AdminSkeleton } from "../_components/admin-skeleton";
import { PlansContent } from "../_components/content";

/** 요금제: each plan's terms, AI configuration and users, its versions (ADR 0181), and the store secrets. */
export default function Page({ searchParams }: PageProps<"/admin/plans">) {
  return (
    <>
      <h1 className="text-display">요금제</h1>
      <Suspense fallback={<AdminSkeleton />}>
        <PlansContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
