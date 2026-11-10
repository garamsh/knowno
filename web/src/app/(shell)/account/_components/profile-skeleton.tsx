import { Skeleton, SkeletonLine } from "@/design/skeleton";

/**
 * The settings page while the session is read: the 내 플랜 group's two rows, the 계정 group with the email and sign-out, the
 * 학습 group's row, the AI 연결 group's three rows and the 화면 group's three rows, in their sizes.
 */
export function ProfileSkeleton() {
  return (
    <Skeleton status="설정을 불러오는 중이에요." className="flex flex-col gap-section-gap">
      {[2, 2, 1, 3, 3].map((rows, section) => (
        <div key={section} className="flex flex-col gap-2">
          <SkeletonLine text="text-section" width="w-10" />
          <div className="flex flex-col divide-y divide-hairline rounded-group bg-surface">
            {Array.from({ length: rows }, (_, row) => (
              <span key={row} className="flex min-h-button items-center px-4 py-3">
                <SkeletonLine text="text-body" width="w-1/3" />
              </span>
            ))}
          </div>
        </div>
      ))}
    </Skeleton>
  );
}
