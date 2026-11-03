"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Chip } from "@/design/chip";

import { switchLink } from "./admin-section";

/** The area's sections, by the job each holds (ADR 0155); a section's own pages keep it current. */
const sections = [
  { href: "/admin", label: "처리할 일" },
  { href: "/admin/decks", label: "노트" },
  { href: "/admin/users", label: "사용자" },
  { href: "/admin/ai", label: "사진 AI" },
  { href: "/admin/settings", label: "설정" },
] as const;

/**
 * The admin area's menu, the current section marked, with 처리할 일 carrying the open reports'
 * count; [openReports] is null while that count could not be read, which 처리할 일 then says.
 */
export function AdminNav({ openReports }: { openReports: number | null }) {
  const path = usePathname();
  return (
    <nav aria-label="관리 메뉴" className="-mx-gutter overflow-x-auto px-gutter lg:mx-0 lg:px-0">
      <ul className="flex gap-1">
        {sections.map(({ href, label }) => {
          const current = href === "/admin" ? path === href : path.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={current ? "page" : undefined}
                className={switchLink(current)}
              >
                {label}
                {href === "/admin" && openReports !== null && openReports > 0 && (
                  <span className="ml-2">
                    <Chip>
                      <span className="sr-only">, 새 신고 </span>
                      {openReports}
                      <span className="sr-only">건</span>
                    </Chip>
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
