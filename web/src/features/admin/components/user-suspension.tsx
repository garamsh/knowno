import { suspendUser } from "../suspend-user";
import { unsuspendUser } from "../unsuspend-user";
import { formatTime } from "../format";
import type { Suspension } from "../read-admin";
import { group, row } from "./admin-section";
import { ConfirmAction } from "./confirm-action";
import { ReasonAction } from "./reason-action";

/** A suspended user's suspension: why, when and by whom. */
export function SuspensionState({
  suspension,
  timeZone,
}: {
  suspension: Suspension;
  timeZone: string;
}) {
  return (
    <div className={group}>
      <div className={row}>
        <p className="text-body-strong break-words">정지됨 · {suspension.reason}</p>
        <p className="text-caption break-words text-muted">
          {formatTime(suspension.suspendedAt, timeZone)}
          {suspension.suspendedByEmail === null ? "" : ` · ${suspension.suspendedByEmail}`}
        </p>
      </div>
    </div>
  );
}

/** 이용 정지, which asks for a reason, or 정지 해제 on a suspended user, each asked first. */
export function SuspensionAction({
  userId,
  email,
  suspended,
}: {
  userId: string;
  email: string;
  suspended: boolean;
}) {
  return suspended ? (
    <ConfirmAction
      compact
      label="정지 해제"
      question={`${email}의 정지를 풀까요?`}
      confirmLabel="정지 해제"
      action={unsuspendUser.bind(null, userId)}
    />
  ) : (
    <ReasonAction
      compact
      label="이용 정지"
      reasonLabel="정지하는 이유"
      question={`${email}의 이용을 정지할까요?`}
      confirmLabel="정지"
      action={suspendUser.bind(null, userId)}
    />
  );
}
