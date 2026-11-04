import { suspendUser } from "../suspend-user";
import { unsuspendUser } from "../unsuspend-user";
import { formatTime } from "../format";
import type { Suspension } from "../read-admin";
import { Section } from "@/design/section";

import { group, row } from "./admin-section";
import { SheetConfirm } from "./sheet-confirm";

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

/**
 * 계정 정지, the panel's last section: a suspended user's suspension, then 정지 해제, or 이용 정지
 * in red text, which asks for a reason; each asked first in the shared sheet, with what it does
 * written under it.
 */
export function SuspensionSection({
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
  const lifts = "정지를 풀면 다시 로그인하고 사진으로 카드를 만들고 동기화할 수 있어요.";
  const blocks =
    "이용 정지하면 로그인, 사진으로 카드 만들기, 동기화가 막혀요. 데이터는 그대로 남아요.";
  return (
    <Section label="계정 정지">
      {suspension !== null && <SuspensionState suspension={suspension} timeZone={timeZone} />}
      {suspension === null ? (
        <SheetConfirm
          look="destructive"
          label="이용 정지"
          question={`${email}의 이용을 정지할까요?`}
          consequence={blocks}
          reasonLabel="정지하는 이유"
          confirmLabel="정지"
          action={suspendUser.bind(null, userId)}
        />
      ) : (
        <SheetConfirm
          look="text"
          label="정지 해제"
          question={`${email}의 정지를 풀까요?`}
          consequence={lifts}
          confirmLabel="정지 해제"
          action={unsuspendUser.bind(null, userId)}
        />
      )}
      <p className="px-1 text-caption text-muted">{suspension === null ? blocks : lifts}</p>
    </Section>
  );
}
