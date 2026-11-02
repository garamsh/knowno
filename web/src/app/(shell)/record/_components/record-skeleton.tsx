import { Skeleton, SkeletonLine } from "@/design/skeleton";

/** The 기록 page while its record is read: the period control and the four charts' cards, in their sizes. */
export function RecordSkeleton() {
  return (
    <Skeleton status="기록을 불러오는 중이에요." className="flex flex-col gap-4">
      <span className="min-h-14 w-full rounded-field bg-hairline lg:max-w-list" />
      <div className="grid gap-4 lg:grid-cols-2">
        {["lg:col-span-2 h-72", "h-44", "h-56", "lg:col-span-2 h-72"].map((size) => (
          <div key={size} className={`flex flex-col gap-3 rounded-card bg-surface p-4 ${size}`}>
            <SkeletonLine text="text-label" width="w-2/5" />
          </div>
        ))}
      </div>
    </Skeleton>
  );
}
