import { Skeleton, SkeletonLine } from "@/design/skeleton";

/** The 노트 page while it is read: the heading, the search and three deck rows, in their sizes. */
export function DecksSkeleton() {
  return (
    <Skeleton status="노트를 불러오는 중이에요." className="flex flex-col gap-5">
      <SkeletonLine text="text-display" width="w-32" />
      <div className="flex flex-col gap-3">
        <span className="h-search rounded-field border border-outline bg-surface" />
        <div className="grid gap-row-gap lg:grid-cols-2">
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="flex min-h-13 items-center gap-3 rounded-row bg-surface py-3 pr-3 pl-4"
            >
              <span className="size-deck-tile shrink-0 rounded-field bg-hairline" />
              <span className="flex flex-1 flex-col gap-1.5">
                <SkeletonLine text="text-body-strong" width="w-2/5" />
                <span className="h-1.5 rounded-full bg-hairline" />
                <SkeletonLine text="text-caption" width="w-1/4" />
              </span>
            </div>
          ))}
        </div>
      </div>
    </Skeleton>
  );
}
