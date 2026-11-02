import Link from "next/link";

import { formatTime } from "../format";
import { actionLabels, labelOf, planLabels, termsLabel } from "../labels";
import type { AuditEntry } from "../read-admin";
import { Empty, group } from "./admin-section";

/** What an entry acted on: the deck's name or the user's email it recorded, linked where it can be opened. */
function Target({ entry }: { entry: AuditEntry }) {
  const name = entry.detail.name;
  const email = entry.detail.email;
  const words =
    typeof name === "string"
      ? name
      : typeof email === "string"
        ? email
        : entry.targetKind === "plan"
          ? labelOf(planLabels, entry.targetId)
          : entry.targetKind === "prompt"
            ? `버전 ${entry.targetId}`
            : entry.targetId;
  const href =
    entry.targetKind === "deck"
      ? `/admin/decks/${entry.targetId}`
      : entry.targetKind === "user"
        ? `/admin/users/${entry.targetId}`
        : entry.targetKind === "plan"
          ? "/admin/settings"
          : entry.targetKind === "prompt"
            ? `/admin/ai/${entry.targetId}`
            : null;
  return href === null ? (
    <span>{words}</span>
  ) : (
    <Link
      href={href}
      className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink"
    >
      {words}
    </Link>
  );
}

/** The audit log, newest first: when, who, what and on what. */
export function AuditLog({ entries, timeZone }: { entries: AuditEntry[]; timeZone: string }) {
  if (entries.length === 0) {
    return <Empty>기록된 작업이 없어요. 관리자가 작업하면 여기에 남아요.</Empty>;
  }
  return (
    <ul aria-label="작업 기록" className={group}>
      {entries.map((entry) => (
        <li key={entry.id} className="flex flex-col gap-1 px-4 py-3">
          <span className="text-body-strong">
            {labelOf(actionLabels, entry.action)} · <Target entry={entry} />
            {typeof entry.detail.reports === "number" ? ` · ${String(entry.detail.reports)}건` : ""}
            {typeof entry.detail.reason === "string" ? ` · ${entry.detail.reason}` : ""}
            {typeof entry.detail.plan === "string"
              ? ` · ${labelOf(planLabels, entry.detail.plan)}`
              : ""}
            {typeof entry.detail.model === "string" && typeof entry.detail.daily_limit === "number"
              ? ` · ${entry.detail.model} · 하루 ${String(entry.detail.daily_limit)}장`
              : ""}
            {typeof entry.detail.model === "string" &&
            typeof entry.detail.quota === "string" &&
            typeof entry.detail.amount === "number"
              ? ` · ${entry.detail.model} · ${termsLabel(entry.detail.quota, entry.detail.amount)}`
              : ""}
            {entry.detail.applies_to_all === true ? " · 기존 사용자도 적용" : ""}
          </span>
          <span className="text-caption text-muted">
            {formatTime(entry.at, timeZone)} · {entry.adminEmail}
          </span>
        </li>
      ))}
    </ul>
  );
}
