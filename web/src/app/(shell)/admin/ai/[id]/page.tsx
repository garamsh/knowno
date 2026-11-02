import { Suspense } from "react";

import { AdminSkeleton } from "../../_components/admin-skeleton";
import { PromptContent } from "../../_components/content";

/** One prompt version: its actions, results, difference from the active one, calls and text. */
export default function Page({ params, searchParams }: PageProps<"/admin/ai/[id]">) {
  return (
    <>
      <Suspense fallback={<AdminSkeleton />}>
        <PromptContent params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}
