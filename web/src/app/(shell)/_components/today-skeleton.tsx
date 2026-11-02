import { Skeleton, SkeletonLine } from "@/design/skeleton";

/**
 * 홈 while it is read: the hero with its title, mascot, count and button in their places, and the
 * drawer's heading and two rows.
 */
export function TodaySkeleton() {
  return (
    <Skeleton status="오늘 할 카드를 불러오는 중이에요." className="flex flex-col">
      <div className="-mx-gutter -mt-6 flex min-h-[calc(100dvh-16rem)] flex-col bg-hero px-gutter pt-6 pb-14 lg:mx-0 lg:mt-0 lg:min-h-0 lg:rounded-card lg:p-8">
        <SkeletonLine text="text-display" width="w-28" />
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6">
          <span className="size-mascot-hero rounded-full bg-on-hero/15" />
          <span className="h-17 w-48 rounded-field bg-on-hero/15" />
          <span className="mt-4 min-h-cta w-56 rounded-button bg-on-hero/15" />
        </div>
      </div>
      <div className="relative -mx-gutter -mt-8 flex flex-col gap-3 rounded-t-sheet bg-ground px-gutter pt-3 lg:mx-0 lg:mt-6 lg:rounded-none lg:p-0">
        <span className="mx-auto block h-1.5 w-11 rounded-full bg-edge lg:hidden" />
        <SkeletonLine text="text-headline" width="w-28" />
        <span className="h-19 rounded-row bg-surface" />
        <span className="h-19 rounded-row bg-surface" />
      </div>
    </Skeleton>
  );
}
