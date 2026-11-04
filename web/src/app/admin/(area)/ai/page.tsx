import { Suspense } from "react";

import { AdminSkeleton } from "../_components/admin-skeleton";
import { AiContent } from "../_components/content";

/** AI: each plan's configuration, the chosen plan's draft, the keys, the prompt versions and the results. */
export default function Page({ searchParams }: PageProps<"/admin/ai">) {
  return (
    <>
      <h1 className="text-display">AI</h1>
      <Suspense fallback={<AdminSkeleton />}>
        <AiContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
