import { Suspense } from "react";

import { UsersContent } from "../_components/content";
import { AdminSkeleton } from "../_components/admin-skeleton";

/** Users found by email. */
export default function Page({ searchParams }: PageProps<"/admin/users">) {
  return (
    <>
      <h1 className="text-display">사용자</h1>
      <Suspense fallback={<AdminSkeleton />}>
        <UsersContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
