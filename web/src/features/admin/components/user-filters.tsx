"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

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
  ["pro", "프로"],
  ["max", "맥스"],
  ["special", "스페셜"],
] as const;

const statusOptions = [
  ["", "상태 전체"],
  ["active", "이용 중"],
  ["suspended", "정지됨"],
] as const;

/** The address of the list's first page under [address] with [next] changed, and no user shown. */
function firstPage(address: UserListAddress, next: Partial<UserListAddress>): string {
  return usersHref({ ...address, ...next, page: 1, user: null });
}

/**
 * The users' search and filters over the list (ADR 0181): the email search, applied
 * [searchDelayMs] after the last keystroke, the plan, the status, and how many users a page holds.
 * Each replaces the address on the first page, and the server reads the list again.
 */
export function UserFilters({ address }: { address: UserListAddress }) {
  const router = useRouter();
  const [query, setQuery] = useState(address.query);
  const [, startTransition] = useTransition();
  const applied = useRef(address.query);

  const go = (next: Partial<UserListAddress>) => {
    startTransition(() => {
      router.replace(firstPage({ ...address, query: applied.current }, next));
    });
  };

  useEffect(() => {
    if (query === applied.current) return;
    const timer = setTimeout(() => {
      applied.current = query;
      startTransition(() => {
        router.replace(firstPage(address, { query }));
      });
    }, searchDelayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [query, address, router]);

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
        value={address.plan ?? ""}
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
        value={address.status ?? ""}
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
        value={address.size}
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
