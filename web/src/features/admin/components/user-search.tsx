"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";

import { SearchField } from "@/design/search-field";

import { findUsers } from "../find-users";
import { formatDate } from "../format";
import type { UserMatch, UserPage } from "../read-admin";
import { button, group } from "./admin-section";

/** How long the search waits after the last keystroke before it asks the server. */
export const searchDelayMs = 250;

/** The users page's address for [query] with its pages through [page] shown. */
export function userSearchHref(query: string, page: number): string {
  const params = new URLSearchParams();
  if (query.trim() !== "") params.set("q", query.trim());
  if (query.trim() !== "" && page > 0) params.set("page", String(page));
  const search = params.toString();
  return search === "" ? "/admin/users" : `/admin/users?${search}`;
}

/**
 * The users whose email holds what the admin types, updated in place [searchDelayMs] after the
 * last keystroke: the earlier results stay until the next arrive, an answer to an older query is
 * dropped, and "더 보기" adds the next page. Each search and each page shown replaces the
 * address, so going back to it from a user's page shows the same results.
 */
export function UserSearch({
  initialQuery,
  initialPage,
  initialPageIndex = 0,
  timeZone,
}: {
  initialQuery: string;
  initialPage: UserPage | null;
  /** The last page [initialPage] holds. */
  initialPageIndex?: number;
  timeZone: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [users, setUsers] = useState<UserMatch[]>(initialPage?.users ?? []);
  const [total, setTotal] = useState<number | null>(initialPage?.total ?? null);
  const [page, setPage] = useState(initialPageIndex);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const latest = useRef(0);
  const searched = useRef(initialQuery);

  useEffect(() => {
    if (query === searched.current) return;
    const timer = setTimeout(() => {
      searched.current = query;
      const request = ++latest.current;
      startTransition(async () => {
        const answer = await findUsers(query, 0);
        if (request !== latest.current) return;
        if ("message" in answer) {
          setMessage(answer.message);
          return;
        }
        setMessage(null);
        setUsers(answer.users);
        setTotal(query.trim() === "" ? null : answer.total);
        setPage(0);
        // Next.js keeps its router in step with the address replaced, and reads nothing again.
        window.history.replaceState(null, "", userSearchHref(query, 0));
      });
    }, searchDelayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [query]);

  const more = () => {
    const request = ++latest.current;
    startTransition(async () => {
      const answer = await findUsers(searched.current, page + 1);
      if (request !== latest.current) return;
      if ("message" in answer) {
        setMessage(answer.message);
        return;
      }
      setUsers((shown) => [...shown, ...answer.users]);
      setPage(page + 1);
      window.history.replaceState(null, "", userSearchHref(searched.current, page + 1));
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div role="search">
        <SearchField
          label="이메일 검색"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
      </div>
      <p role="status" aria-live="polite" className="min-h-6 text-caption text-muted">
        {message ??
          (total === null
            ? ""
            : total === 0
              ? "찾는 사용자가 없어요. 다른 단어로 검색해 보세요."
              : `${String(total)}명`)}
      </p>
      <ul aria-busy={pending} className={`${group} overflow-hidden empty:hidden`}>
        {users.map((user) => (
          <li key={user.id}>
            <Link
              href={`/admin/users/${user.id}`}
              className="pressable flex min-h-13 items-center justify-between gap-3 px-4 py-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink"
            >
              <span className="truncate text-body-strong">{user.email}</span>
              <span className="text-caption whitespace-nowrap text-muted">
                {user.suspended ? "정지 · " : ""}
                {formatDate(user.createdAt, timeZone)} 가입
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {total !== null && users.length < total && (
        <button type="button" disabled={pending} onClick={more} className={button.secondary}>
          더 보기
        </button>
      )}
    </div>
  );
}
