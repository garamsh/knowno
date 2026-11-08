import type { Metadata } from "next";
import { Suspense } from "react";

import { AssistantChat, readAllowance, readNote } from "@/features/assistant";

import { Skeleton, SkeletonLine } from "@/design/skeleton";

export const metadata: Metadata = { title: "말랑이 · 알아몰라" };

async function Chat({ note }: { note: Promise<string | string[] | undefined> }) {
  const [allowance, opened] = await Promise.all([readAllowance(), note.then(readNote)]);
  return <AssistantChat allowance={allowance} note={opened} />;
}

/**
 * 말랑이's chat (#722): the conversation is this browser's, so the server reads only the day's
 * tokens left, and the name of the note `?note=` says the chat was opened from, under a skeleton
 * of the chat's bar and message field.
 */
export default function AssistantPage({ searchParams }: PageProps<"/assistant">) {
  return (
    <Suspense
      fallback={
        <Skeleton
          status="말랑이를 불러오는 중이에요."
          className="fixed inset-x-0 top-0 bottom-0 z-20 flex flex-col justify-between bg-ground lg:left-60"
        >
          <div className="mx-auto flex w-full max-w-study items-center gap-2 px-gutter py-2">
            <span className="size-tap-target" />
            <span className="size-10 rounded-full bg-hairline" />
            <SkeletonLine text="text-body-strong" width="w-16" />
          </div>
          <div className="mx-auto w-full max-w-study px-gutter pb-4">
            <span className="block min-h-cta rounded-field bg-surface" />
          </div>
        </Skeleton>
      }
    >
      <Chat note={searchParams.then((query) => query.note)} />
    </Suspense>
  );
}
