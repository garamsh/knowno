import Link from "next/link";

import { Chip } from "@/design/chip";

import { formatDate } from "../format";
import { labelOf, planLabels } from "../labels";
import type { UserPage } from "../read-admin";
import { type UserListAddress, usersHref } from "../user-list";
import { Empty } from "./admin-section";
import { AdminTable, CellLabel, cellClass, Pager, rowClass } from "./admin-table";

const head = [
  { label: "이메일" },
  { label: "가입" },
  { label: "마지막 학습", detail: true },
  { label: "노트", numeric: true, detail: true },
  { label: "카드", numeric: true, detail: true },
  { label: "요금제" },
  { label: "상태" },
] as const;

/**
 * A page of the users' list as a table (ADR 0181), newest sign-up first: each user's email, which
 * opens its details beside the list, its sign-up, last study, notes, cards, plan and state, then
 * the pager. While a user is shown beside it, the table leaves out the last study, notes and
 * cards, which the user's details hold, so the email keeps its room.
 */
export function UserTable({
  page,
  address,
  timeZone,
}: {
  page: UserPage;
  address: UserListAddress;
  timeZone: string;
}) {
  const brief = address.user !== null;
  if (page.users.length === 0) {
    const filtered = address.query !== "" || address.plan !== null || address.status !== null;
    return (
      <Empty>
        {filtered
          ? "찾는 사용자가 없어요. 다른 단어나 조건으로 찾아보세요."
          : "사용자가 없어요. 누군가 가입하면 여기에 보여요."}
      </Empty>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <AdminTable
        label="사용자 목록"
        head={brief ? head.filter((column) => !("detail" in column)) : head}
      >
        {page.users.map((user) => {
          const current = user.id === address.user;
          return (
            <tr key={user.id} className={rowClass({ current, linked: true })}>
              <td className={`${cellClass({ lead: true })} lg:w-full lg:max-w-0 lg:min-w-48`}>
                <Link
                  href={usersHref({ ...address, user: user.id })}
                  aria-current={current ? "true" : undefined}
                  className="block truncate text-body-strong after:absolute after:inset-0 focus-visible:outline-none after:focus-visible:outline-2 after:focus-visible:-outline-offset-2 after:focus-visible:outline-ink"
                >
                  {user.email}
                </Link>
              </td>
              <td className={`${cellClass()} whitespace-nowrap`}>
                <CellLabel>가입</CellLabel>
                {formatDate(user.createdAt, timeZone)}
              </td>
              {!brief && (
                <>
                  <td className={`${cellClass()} whitespace-nowrap`}>
                    <CellLabel>마지막 학습</CellLabel>
                    {user.lastAnswerAt === null ? "없음" : formatDate(user.lastAnswerAt, timeZone)}
                  </td>
                  <td className={cellClass({ numeric: true })}>
                    <CellLabel>노트</CellLabel>
                    {user.decks.toLocaleString("ko-KR")}
                  </td>
                  <td className={cellClass({ numeric: true })}>
                    <CellLabel>카드</CellLabel>
                    {user.cards.toLocaleString("ko-KR")}
                  </td>
                </>
              )}
              <td className={cellClass()}>
                {user.plan === null ? (
                  "없음"
                ) : (
                  <Chip tone="brand">{labelOf(planLabels, user.plan)}</Chip>
                )}
              </td>
              <td className={cellClass()}>
                <span className="flex gap-1">
                  {user.admin && <Chip tone="brand">관리자</Chip>}
                  {user.suspended && <Chip tone="amber">정지됨</Chip>}
                </span>
              </td>
            </tr>
          );
        })}
      </AdminTable>
      <Pager
        label="사용자 페이지"
        page={address.page}
        size={address.size}
        total={page.total}
        href={(shown) => usersHref({ ...address, page: shown, user: null })}
      />
    </div>
  );
}
