import { Suspense } from "react";

import { UsersContent } from "../_components/content";
import { AdminSkeleton } from "../_components/admin-skeleton";

/** Every user as a paged table, with the one chosen beside it (ADR 0181). */
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
