import { Suspense } from "react";

import { UserContent } from "../../_components/content";
import { AdminSkeleton } from "../../_components/admin-skeleton";

/** One user, read-only. */
export default function Page({ params }: PageProps<"/admin/users/[id]">) {
  return (
    <>
      <Suspense fallback={<AdminSkeleton />}>
        <UserContent params={params} />
      </Suspense>
    </>
  );
}
