import { Suspense } from "react";

import { AdminSkeleton } from "../../_components/admin-skeleton";
import { NewPromptContent } from "../../_components/content";

/** A new prompt version, from the active one or the version the address names. */
export default function Page({ searchParams }: PageProps<"/admin/ai/new">) {
  return (
    <>
      <h1 className="text-display">새 버전</h1>
      <p className="text-caption text-muted">
        모든 버전 뒤에는 함수에 고정된 출력 계약(카드의 필드와 규칙)이 함께 보내져요.
      </p>
      <Suspense fallback={<AdminSkeleton />}>
        <NewPromptContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
