import { Skeleton, SkeletonLine } from "@/design/skeleton";
import { group, row } from "@/features/admin";

/** An admin page's placeholder: one group of three rows, as every admin page lists its rows. */
export function AdminSkeleton() {
  return (
    <Skeleton status="불러오는 중이에요." className="flex flex-col gap-2">
      <SkeletonLine text="text-section" width="w-20" />
      <div className={group}>
        {[0, 1, 2].map((line) => (
          <div key={line} className={row}>
            <SkeletonLine text="text-body-strong" width="w-40" />
            <SkeletonLine text="text-caption" width="w-64" />
          </div>
        ))}
      </div>
    </Skeleton>
  );
}
