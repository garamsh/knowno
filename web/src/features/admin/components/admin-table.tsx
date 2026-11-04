import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { switchLink } from "./admin-section";

/**
 * A table of the admin area, as `design/frames.md` §Table lays one out: from 1024 px one surface on
 * its edge, its header row in the `section` type, its rows split by hairlines; below it the header
 * row goes and each row is a card of its own, its cells wrapping, each naming what it holds through
 * [CellLabel].
 */
export function AdminTable({
  label,
  head,
  children,
}: {
  label: string;
  /** Each column's heading, a number's aligned to the end. */
  head: readonly { label: string; numeric?: boolean }[];
  children: ReactNode;
}) {
  return (
    <div className="lg:overflow-x-auto lg:rounded-group lg:bg-surface lg:shadow-card">
      <table aria-label={label} className="w-full border-collapse text-body max-lg:block">
        <thead className="max-lg:hidden">
          <tr className="border-b border-hairline">
            {head.map((column) => (
              <th
                key={column.label}
                scope="col"
                className={`px-3 py-3 text-section whitespace-nowrap text-muted first:pl-4 last:pr-4 ${
                  column.numeric === true ? "text-right" : "text-left"
                }`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="max-lg:flex max-lg:flex-col max-lg:gap-row-gap max-lg:pb-2 lg:divide-y lg:divide-hairline">
          {children}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A row of an [AdminTable], a card of its own below 1024 px; [current] marks the one a side panel
 * shows on the ground, and [linked] lets a link in it stretch over the whole row.
 */
export function rowClass({
  current = false,
  linked = false,
}: { current?: boolean; linked?: boolean } = {}): string {
  return `max-lg:flex max-lg:flex-wrap max-lg:items-center max-lg:gap-x-3 max-lg:gap-y-1 max-lg:rounded-row max-lg:bg-surface max-lg:px-4 max-lg:py-3 max-lg:shadow-row ${
    linked ? "relative pressable" : ""
  } ${current ? "lg:bg-ground" : ""}`;
}

/** A cell of an [AdminTable]; a [numeric] one aligned to the end, a [lead] one alone on its line below 1024 px. */
export function cellClass({
  numeric = false,
  lead = false,
}: { numeric?: boolean; lead?: boolean } = {}): string {
  return `lg:px-3 lg:py-3 lg:first:pl-4 lg:last:pr-4 align-middle max-lg:empty:hidden ${
    numeric ? "tabular-nums lg:text-right" : ""
  } ${lead ? "max-lg:min-w-0 max-lg:basis-full" : "max-lg:text-caption max-lg:text-ink-2"}`;
}

/** What a cell holds, said before its value below 1024 px, where the header row is not shown. */
export function CellLabel({ children }: { children: string }) {
  return <span className="lg:hidden">{children} </span>;
}

/** The pages to offer around [current] of [count]: the first, the last, and the two beside it. */
export function pagesAround(current: number, count: number): (number | "gap")[] {
  const shown = [...new Set([1, current - 1, current, current + 1, count])]
    .filter((page) => page >= 1 && page <= count)
    .sort((a, b) => a - b);
  const pages: (number | "gap")[] = [];
  for (const page of shown) {
    const last = pages.at(-1);
    // A gap that would hide one page shows that page instead.
    if (typeof last === "number" && page - last === 2) pages.push(last + 1);
    else if (typeof last === "number" && page - last > 2) pages.push("gap");
    pages.push(page);
  }
  return pages;
}

/**
 * The pager under a table: from 1024 px which rows of how many it shows, as "1–20 / 1,284", and the
 * pages around the current one, each a link [href] makes; below it the page of how many, as
 * "1 / 65", which fits a phone however many pages there are. The one before and the one after
 * stand at both widths.
 */
export function Pager({
  label,
  page,
  size,
  total,
  href,
}: {
  label: string;
  /** The page shown, from 1. */
  page: number;
  size: number;
  total: number;
  href: (page: number) => string;
}) {
  const count = Math.max(1, Math.ceil(total / size));
  const first = total === 0 ? 0 : (page - 1) * size + 1;
  const last = Math.min(page * size, total);
  const still = "flex min-h-tap-target min-w-tap-target items-center justify-center text-muted";
  return (
    <nav
      aria-label={label}
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1"
    >
      <p className="text-caption text-ink-2 tabular-nums max-lg:hidden">
        {first.toLocaleString("ko-KR")}–{last.toLocaleString("ko-KR")} /{" "}
        {total.toLocaleString("ko-KR")}
      </p>
      <p className="text-caption text-ink-2 tabular-nums lg:hidden">
        {page.toLocaleString("ko-KR")} / {count.toLocaleString("ko-KR")}
      </p>
      <ul className="flex items-center gap-1 pb-2">
        <li>
          {page > 1 ? (
            <Link href={href(page - 1)} aria-label="이전 페이지" className={switchLink(false)}>
              <ChevronLeft aria-hidden className="size-5" strokeWidth={2.4} />
            </Link>
          ) : (
            <span aria-hidden className={still}>
              <ChevronLeft className="size-5" strokeWidth={2.4} />
            </span>
          )}
        </li>
        {pagesAround(page, count).map((shown, index) =>
          shown === "gap" ? (
            <li key={`gap-${String(index)}`} aria-hidden className={`${still} max-lg:hidden`}>
              …
            </li>
          ) : (
            <li key={shown} className="max-lg:hidden">
              <Link
                href={href(shown)}
                aria-current={shown === page ? "page" : undefined}
                aria-label={`${String(shown)}페이지`}
                className={`${switchLink(shown === page)} justify-center tabular-nums`}
              >
                {shown}
              </Link>
            </li>
          ),
        )}
        <li>
          {page < count ? (
            <Link href={href(page + 1)} aria-label="다음 페이지" className={switchLink(false)}>
              <ChevronRight aria-hidden className="size-5" strokeWidth={2.4} />
            </Link>
          ) : (
            <span aria-hidden className={still}>
              <ChevronRight className="size-5" strokeWidth={2.4} />
            </span>
          )}
        </li>
      </ul>
    </nav>
  );
}
