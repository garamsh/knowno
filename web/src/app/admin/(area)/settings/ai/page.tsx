import { Suspense } from "react";

import { AdminSkeleton } from "../../_components/admin-skeleton";
import { AiSettingsContent } from "../../_components/content";

/** 설정, AI 제공자: the providers' keys and each plan's provider and model (ADR 0162). */
export default function Page() {
  return (
    <>
      <h1 className="text-display">AI</h1>
      <Suspense fallback={<AdminSkeleton />}>
        <AiSettingsContent />
      </Suspense>
    </>
  );
}
