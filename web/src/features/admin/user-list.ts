import type { PlanId, UserStatus } from "./read-admin";

/** How many users a page of the list may hold, the first the default (ADR 0181). */
export const userPageSizes = [20, 50, 100] as const;

export type UserPageSize = (typeof userPageSizes)[number];

/** What the users' address holds: the search, the filters, the page, its size and the user shown beside the list. */
export type UserListAddress = {
  query: string;
  plan: PlanId | null;
  status: UserStatus | null;
  /** The page shown, from 1. */
  page: number;
  size: UserPageSize;
  /** The user whose details the side panel shows, or null. */
  user: string | null;
};

/** The users page's address for [address], leaving out every part that is its default. */
export function usersHref(address: UserListAddress): string {
  const params = new URLSearchParams();
  if (address.query.trim() !== "") params.set("q", address.query.trim());
  if (address.plan !== null) params.set("plan", address.plan);
  if (address.status !== null) params.set("status", address.status);
  if (address.size !== userPageSizes[0]) params.set("size", String(address.size));
  if (address.page > 1) params.set("page", String(address.page));
  if (address.user !== null) params.set("user", address.user);
  const search = params.toString();
  return search === "" ? "/users" : `/users?${search}`;
}

/** [value], an address's or a select's, as a plan to filter by; null for every plan. */
export function parsePlanFilter(value: unknown): PlanId | null {
  return value === "free" || value === "pro" || value === "max" || value === "special"
    ? value
    : null;
}

/** [value], an address's or a select's, as a status to filter by; null for every status. */
export function parseStatusFilter(value: unknown): UserStatus | null {
  return value === "active" || value === "suspended" ? value : null;
}
