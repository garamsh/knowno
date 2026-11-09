import { ScreenSkeleton } from "@/design/screen-skeleton";
import { Skeleton, SkeletonLine } from "@/design/skeleton";

/**
 * A note's page while it is read: the bar's place, its name, the search, the study button, the row
 * above the cards and four cards in one group, in their sizes.
 */
export function DeckSkeleton() {
  return (
    <Skeleton status="노트를 불러오는 중이에요." className="flex flex-1 flex-col">
      <ScreenSkeleton
        placeholder
        title={<SkeletonLine text="text-deck-name" width="w-1/3" />}
        actions={<span className="size-tap-target shrink-0 rounded-chip bg-surface" />}
        search={<span className="block h-search rounded-field bg-surface" />}
      >
        <span className="min-h-cta rounded-button bg-hairline" />
        <div className="flex flex-col gap-3">
          <span className="min-h-tap-target" />
          <div className="flex flex-col divide-y divide-hairline rounded-group bg-surface">
            {[0, 1, 2, 3].map((card) => (
              <span key={card} className="flex min-h-cta items-center px-4 py-3">
                <SkeletonLine text="text-body-strong" width="w-1/3" />
              </span>
            ))}
          </div>
        </div>
      </ScreenSkeleton>
    </Skeleton>
  );
}
