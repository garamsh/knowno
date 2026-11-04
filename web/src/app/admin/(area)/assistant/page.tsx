import { Suspense } from "react";

import { AdminSkeleton } from "../_components/admin-skeleton";
import { AssistantContent } from "../_components/content";

/** 말랑이: each plan's assistant configuration and message limit, the chosen plan's draft and the prompt versions. */
export default function Page({ searchParams }: PageProps<"/admin/assistant">) {
  return (
    <>
      <h1 className="text-display">말랑이</h1>
      <Suspense fallback={<AdminSkeleton />}>
        <AssistantContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
