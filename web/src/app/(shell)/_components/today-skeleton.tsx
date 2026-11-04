import { Skeleton, SkeletonLine } from "@/design/skeleton";

import { belowHero, heroFold, heroGroup } from "./hero-fold";

/**
 * 홈 while it is read: the hero with its title, mascot, count and button in their places, and the
 * week card under it, laid out as 홈 is.
 */
export function TodaySkeleton() {
  return (
    <Skeleton status="오늘 할 카드를 불러오는 중이에요." className="">
      <div
        className={`${heroFold(true)} -mx-gutter rounded-b-sheet bg-hero px-gutter pt-6 pb-5 lg:mx-0 lg:rounded-card lg:p-8`}
      >
        <div className="mb-4 flex min-h-tap-target items-center">
          <SkeletonLine text="text-title" width="w-28" />
        </div>
        <div className={heroGroup}>
          <span className="rounded-full bg-on-hero/15" />
          <span className="h-17 w-48 rounded-field bg-on-hero/15" />
          <span className="mt-2 min-h-cta w-56 rounded-button bg-on-hero/15" />
        </div>
      </div>
      <span className={`${belowHero} block h-38 rounded-card bg-surface`} />
    </Skeleton>
  );
}
