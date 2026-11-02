import { cardHeight } from "@/features/study";
import { Skeleton, SkeletonLine } from "@/design/skeleton";

/**
 * The study page while its cards are read: the header with the progress bar, the previous card's
 * place, outlined as it is while it holds no card, the current card with its
 * front alone, and the two answer buttons, in their sizes.
 */
export function StudySkeleton() {
  return (
    <main className="mx-auto w-full max-w-6xl px-gutter py-6">
      <Skeleton status="카드를 불러오는 중이에요." className="flex flex-col gap-6">
        <div className="flex items-center gap-4">
          <span className="size-tap-target shrink-0" />
          <span className="h-progress flex-1 rounded-full bg-hairline" />
          <span className="hidden min-h-button w-24 rounded-button bg-surface lg:block" />
        </div>
        <span
          className={`mx-auto mt-6 w-full max-w-study rounded-previous border-[1.5px] border-dashed border-outline ${cardHeight}`}
        />
        <div
          className={`mx-auto mt-1 flex w-full max-w-study items-center justify-center rounded-card bg-surface p-6 shadow-raised ${cardHeight}`}
        >
          <SkeletonLine text="text-front" width="w-1/3" />
        </div>
        <div className="mx-auto -mt-3 flex w-full max-w-study gap-3">
          <span className="min-h-cta flex-1 rounded-button bg-tint-red" />
          <span className="min-h-cta flex-1 rounded-button bg-tint-green" />
        </div>
      </Skeleton>
    </main>
  );
}
