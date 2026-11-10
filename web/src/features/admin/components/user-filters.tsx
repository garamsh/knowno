"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { SearchField } from "@/design/search-field";

import {
  parsePlanFilter,
  parseStatusFilter,
  type UserListAddress,
  userPageSizes,
  usersHref,
} from "../user-list";
import { filter } from "./admin-section";

/** How long the search waits after the last keystroke before it changes the address. */
export const searchDelayMs = 250;

const planOptions = [
  ["", "요금제 전체"],
  ["free", "무료"],
  ["pro", "플러스"],
  ["max", "프로"],
  ["special", "스페셜"],
] as const;

const statusOptions = [
  ["", "상태 전체"],
  ["active", "이용 중"],
  ["suspended", "정지됨"],
] as const;

/**
 * The users' search and filters over the list (ADR 0181): the email search, applied
 * [searchDelayMs] after the last keystroke, the plan, the status, and how many users a page holds.
 * Each replaces the address on the first page, and the server reads the list again. A change made
 * while the last one is still read builds on it, not on the list the server drew before it.
 */
export function UserFilters({ address }: { address: UserListAddress }) {
  const router = useRouter();
  const [query, setQuery] = useState(address.query);
  const [shown, setShown] = useState(address);
  const [, startTransition] = useTransition();
  // The addresses the filters asked for and the server has not drawn yet.
  const asked = useRef(new Set<string>());
  const drawn = useRef(usersHref(address));

  // An address drawn that the filters did not ask for, as a page link or the browser's back
  // opens, is taken as it is.
  const href = usersHref(address);
  useEffect(() => {
    if (href === drawn.current) return;
    drawn.current = href;
    const ours = asked.current.has(href);
    asked.current.delete(href);
    if (ours) return;
    asked.current.clear();
    setShown(address);
    setQuery(address.query);
  }, [href, address]);

  const replace = useCallback(
    (changed: UserListAddress) => {
      setShown(changed);
      const next = usersHref(changed);
      asked.current.add(next);
      startTransition(() => {
        router.replace(next);
      });
    },
    [router],
  );

  const go = (next: Partial<UserListAddress>) => {
    replace({ ...shown, ...next, page: 1, user: null });
  };

  useEffect(() => {
    if (query === shown.query) return;
    const timer = setTimeout(() => {
      replace({ ...shown, query, page: 1, user: null });
    }, searchDelayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [query, shown, replace]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="search" className="min-w-60 flex-1">
        <SearchField
          label="이메일로 찾기"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
      </div>
      <select
        aria-label="요금제"
        value={shown.plan ?? ""}
        onChange={(event) => {
          go({ plan: parsePlanFilter(event.target.value) });
        }}
        className={filter}
      >
        {planOptions.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <select
        aria-label="상태"
        value={shown.status ?? ""}
        onChange={(event) => {
          go({ status: parseStatusFilter(event.target.value) });
        }}
        className={filter}
      >
        {statusOptions.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <select
        aria-label="몇 명씩 보기"
        value={shown.size}
        onChange={(event) => {
          const size = userPageSizes.find((known) => String(known) === event.target.value);
          if (size !== undefined) go({ size });
        }}
        className={filter}
      >
        {userPageSizes.map((size) => (
          <option key={size} value={size}>
            {size}명씩
          </option>
        ))}
      </select>
    </div>
  );
}
