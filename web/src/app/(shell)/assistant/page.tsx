import type { Metadata } from "next";
import { Suspense } from "react";

import { AssistantChat, readAllowance } from "@/features/assistant";

import { Skeleton, SkeletonLine } from "@/design/skeleton";

export const metadata: Metadata = { title: "말랑이 · 알아몰라" };

async function Chat() {
  return <AssistantChat allowance={await readAllowance()} />;
}

/**
 * 말랑이's chat (#722): the conversation is this browser's, so the server reads only the day's
 * tokens left, under a skeleton of the chat's bar and message field.
 */
export default function AssistantPage() {
  return (
    <Suspense
      fallback={
        <Skeleton
          status="말랑이를 불러오는 중이에요."
          className="fixed inset-x-0 top-0 bottom-0 z-20 flex flex-col justify-between bg-ground lg:left-60"
        >
          <div className="mx-auto flex w-full max-w-study items-center gap-2 px-gutter py-2">
            <span className="size-tap-target" />
            <span className="flex flex-1 justify-center">
              <SkeletonLine text="text-body-strong" width="w-16" />
            </span>
            <span className="size-tap-target" />
          </div>
          <div className="mx-auto w-full max-w-study px-gutter pb-4">
            <span className="block min-h-cta rounded-field bg-surface" />
          </div>
        </Skeleton>
      }
    >
      <Chat />
    </Suspense>
  );
}
