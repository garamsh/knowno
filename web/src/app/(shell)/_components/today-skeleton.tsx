import { Skeleton, SkeletonLine } from "@/design/skeleton";

import {
  homeFrame,
  homeGround,
  homeMascot,
  homeMascotRoom,
  homeSky,
  homeWords,
} from "./home-frame";

/**
 * 홈 while it is read: the sky with its title, count and the mascot's place, and on the ground the
 * streak and the button in their places, laid out as 홈 is.
 */
export function TodaySkeleton() {
  return (
    <Skeleton status="오늘 할 카드를 불러오는 중이에요." className="">
      <div className={homeFrame}>
        <div className={homeSky}>
          <div className="flex min-h-tap-target items-center lg:hidden">
            <SkeletonLine text="text-title" width="w-28" />
          </div>
          <div className={homeWords}>
            <span className="h-17 w-48 rounded-field bg-on-hero/15" />
          </div>
          <div className={homeMascotRoom}>
            <span className={`${homeMascot} rounded-full bg-on-hero/15`} />
          </div>
        </div>
        <div className={homeGround}>
          <div className="flex flex-1 items-center justify-center">
            <span className="block h-20 w-full rounded-card bg-surface" />
          </div>
          <span className="block min-h-cta w-full rounded-button bg-surface" />
        </div>
      </div>
    </Skeleton>
  );
}
