"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const sections = [
  { href: "/admin", label: "개요" },
  { href: "/admin/reports", label: "신고" },
  { href: "/admin/decks", label: "공개 노트" },
  { href: "/admin/users", label: "사용자" },
  { href: "/admin/plans", label: "요금제" },
  { href: "/admin/prompts", label: "프롬프트" },
  { href: "/admin/extractions", label: "추출 결과" },
  { href: "/admin/admins", label: "관리자" },
  { href: "/admin/audit", label: "작업 기록" },
] as const;

/** The admin area's sections, the current one marked; a section's own pages keep it current. */
export function AdminNav() {
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
                className={`pressable flex min-h-tap-target items-center rounded-button px-3 text-label whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
                  current ? "bg-brand-tint font-bold text-ink" : "text-ink-2"
                }`}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
