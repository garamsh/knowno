import { Skeleton, SkeletonLine } from "@/design/skeleton";

/**
 * A deck's page while it is read: the way back, the header, the white card with its button, the
 * search, the row above the cards and four cards in one group, in their sizes.
 */
export function DeckSkeleton() {
  return (
    <Skeleton status="덱을 불러오는 중이에요." className="flex flex-col gap-5">
      <span className="min-h-tap-target" />
      <div className="flex items-center gap-3.5">
        <span className="size-13 shrink-0 rounded-field bg-hairline" />
        <div className="flex flex-1 flex-col">
          <SkeletonLine text="text-deck-name" width="w-1/3" />
          <SkeletonLine text="text-secondary" width="w-32" />
        </div>
      </div>
      <div className="flex flex-col gap-4 rounded-card bg-surface p-5 shadow-card lg:p-6">
        <div className="flex flex-col gap-1">
          <SkeletonLine text="text-secondary" width="w-16" />
          <SkeletonLine text="text-figure" width="w-16" />
        </div>
        <span className="min-h-cta rounded-button bg-hairline sm:w-60" />
      </div>
      <div className="flex flex-col gap-3">
        <span className="h-search rounded-field border border-outline bg-surface" />
        <span className="min-h-tap-target" />
        <div className="flex flex-col divide-y divide-hairline rounded-group bg-surface">
          {[0, 1, 2, 3].map((card) => (
            <span key={card} className="flex min-h-cta items-center px-4 py-3">
              <SkeletonLine text="text-body-strong" width="w-1/3" />
            </span>
          ))}
        </div>
      </div>
    </Skeleton>
  );
}
