import { suspendUser } from "../suspend-user";
import { unsuspendUser } from "../unsuspend-user";
import { formatTime } from "../format";
import type { Suspension } from "../read-admin";
import { AdminSection, group, row } from "./admin-section";
import { ConfirmAction } from "./confirm-action";
import { ReasonAction } from "./reason-action";

/**
 * Whether a user is suspended, why and by whom, with the way to suspend or lift it, at the end of
 * the user's page.
 */
export function UserSuspension({
  userId,
  email,
  suspension,
  timeZone,
}: {
  userId: string;
  email: string;
  suspension: Suspension | null;
  timeZone: string;
}) {
  return (
    <AdminSection
      label="이용 정지"
      note={
        suspension === null
          ? "정지하면 로그인, 사진으로 카드 만들기, 동기화가 막혀요. 데이터는 그대로 남아요."
          : undefined
      }
    >
      {suspension === null ? (
        <ReasonAction
          compact
          label="이용 정지"
          reasonLabel="정지하는 이유"
          question={`${email}의 이용을 정지할까요?`}
          confirmLabel="정지"
          action={suspendUser.bind(null, userId)}
        />
      ) : (
        <>
          <div className={group}>
            <div className={row}>
              <p className="text-body-strong">정지됨 · {suspension.reason}</p>
              <p className="text-caption text-muted">
                {formatTime(suspension.suspendedAt, timeZone)}
                {suspension.suspendedByEmail === null ? "" : ` · ${suspension.suspendedByEmail}`}
              </p>
            </div>
          </div>
          <ConfirmAction
            compact
            label="정지 해제"
            question={`${email}의 정지를 풀까요?`}
            confirmLabel="정지 해제"
            action={unsuspendUser.bind(null, userId)}
          />
        </>
      )}
    </AdminSection>
  );
}
