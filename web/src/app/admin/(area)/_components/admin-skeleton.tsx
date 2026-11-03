import { Skeleton, SkeletonLine } from "@/design/skeleton";

/** An admin page's placeholder: one group of three rows, as every admin page lists its rows. */
export function AdminSkeleton() {
  return (
    <Skeleton status="불러오는 중이에요." className="flex flex-col gap-2">
      <SkeletonLine text="text-section" width="w-20" />
      <div className="flex flex-col divide-y divide-hairline rounded-group bg-surface">
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex flex-col gap-1 px-4 py-3">
            <SkeletonLine text="text-body-strong" width="w-40" />
            <SkeletonLine text="text-caption" width="w-64" />
          </div>
        ))}
      </div>
    </Skeleton>
  );
}
