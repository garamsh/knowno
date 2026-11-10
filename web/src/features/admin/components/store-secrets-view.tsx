import Link from "next/link";

import { Chip } from "@/design/chip";
import { Section } from "@/design/section";

import { clearStoreSecret } from "../clear-store-secret";
import { formatTime } from "../format";
import type { StoreSecret, StoreSecretName } from "../read-admin";
import { button, group, row } from "./admin-section";
import { ConfirmAction } from "./confirm-action";
import { StoreSecretForm } from "./store-secret-form";

const labels: Record<StoreSecretName, string> = {
  knowno_store_webhook_authorization: "웹훅 Authorization 값",
  knowno_store_api_key: "시크릿 API 키",
};

/**
 * 스토어 비밀값 (ADR 0241): the two RevenueCat secrets, each shown as set or not, with who set it
 * and when, never its value. [editing] is the one whose form the address opens, in the provider
 * key form's way (ADR 0162).
 */
export function StoreSecretsView({
  secrets,
  editing,
  timeZone,
}: {
  secrets: StoreSecret[];
  editing: StoreSecretName | null;
  timeZone: string;
}) {
  return (
    <Section
      label="스토어 비밀값"
      note="RevenueCat의 값이에요. 저장한 뒤 다시 볼 수 없고, 설정 여부만 보여요. 저장과 삭제는 10분 안에 로그인한 관리자만 할 수 있어요."
    >
      <ul aria-label="스토어 비밀값" className={group}>
        {secrets.map((entry) => {
          const label = labels[entry.name];
          return (
            <li key={entry.name} className={`${row} gap-2`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-body-strong">{label}</span>
                <Chip tone={entry.set === null ? "neutral" : "brand"}>
                  {entry.set === null ? "없음" : "설정됨"}
                </Chip>
              </div>
              {entry.set !== null && (
                <p className="text-caption text-muted">
                  {formatTime(entry.set.at, timeZone)}
                  {entry.set.byEmail === null ? "" : ` · ${entry.set.byEmail}`}
                </p>
              )}
              {editing === entry.name ? (
                <>
                  <StoreSecretForm name={entry.name} label={label} replacing={entry.set !== null} />
                  <div className="flex flex-wrap items-start gap-2 [&>*:has([role=group])]:basis-full">
                    {entry.set !== null && (
                      <ConfirmAction
                        compact
                        label="값 삭제"
                        question={`${label}을 삭제할까요?`}
                        confirmLabel="삭제"
                        action={clearStoreSecret.bind(null, entry.name)}
                      />
                    )}
                    <Link href="/plans" className={button.row}>
                      닫기
                    </Link>
                  </div>
                </>
              ) : (
                <Link href={`/plans?secret=${entry.name}`} className={button.row}>
                  {entry.set === null ? "값 저장" : "값 바꾸기"}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
