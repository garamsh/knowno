import Link from "next/link";

import { Section } from "@/design/section";

import { formatDate } from "../format";
import type { PromptVersion } from "../read-admin";
import { button, Empty, group, linkRow } from "./admin-section";

/** The words for a version's labels: 사용 중 for an active configuration's, 초안에서 사용 for a draft's. */
function labelWords(version: PromptVersion): string[] {
  return [
    ...(version.labels.includes("active") ? ["사용 중"] : []),
    ...(version.labels.includes("test") ? ["초안에서 사용"] : []),
  ];
}

/**
 * 프롬프트 버전: every version, newest first, each opening the form from it at [writeHref], and 새
 * 버전 쓰기, which opens it from the active version.
 */
export function PromptVersions({
  versions,
  writeHref,
  timeZone,
}: {
  versions: PromptVersion[];
  writeHref: (from: number | "active") => string;
  timeZone: string;
}) {
  return (
    <Section label="프롬프트 버전" note="버전을 누르면 그 버전에서 새 버전을 써요.">
      {versions.length === 0 ? (
        <Empty>저장된 버전이 없어요. 새 버전을 써 보세요.</Empty>
      ) : (
        <ul aria-label="프롬프트 버전" className={`${group} overflow-hidden`}>
          {versions.map((version) => (
            <li key={version.id}>
              <Link href={writeHref(version.id)} className={linkRow}>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="text-body-strong">
                    {[
                      `v${String(version.id)}`,
                      ...labelWords(version),
                      formatDate(version.createdAt, timeZone),
                    ].join(" · ")}
                  </span>
                  {version.note !== "" && (
                    <span className="text-caption text-ink-2 break-words">{version.note}</span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link href={writeHref("active")} className={`${button.row} mt-1`}>
        새 버전 쓰기
      </Link>
    </Section>
  );
}
