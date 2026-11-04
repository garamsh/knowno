"use client";

import { ChartColumn, House, type LucideIcon, NotebookText } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { BrandMark } from "@/design/brand";
import { FittedLine } from "@/design/fitted-line";

/** A page the menus open, and whether a path is that page or below it. */
type Item = { href: string; label: string; Icon: LucideIcon; current: (path: string) => boolean };

// 홈 sits in the middle; 노트 is current on a note's page too (ADR 0165).
const items: readonly Item[] = [
  {
    href: "/record",
    label: "기록",
    Icon: ChartColumn,
    current: (path) => path.startsWith("/record"),
  },
  {
    href: "/",
    label: "홈",
    Icon: House,
    current: (path) => path === "/",
  },
  {
    href: "/decks",
    label: "노트",
    Icon: NotebookText,
    current: (path) => path.startsWith("/decks"),
  },
];

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

/** The place of a menu item's icon, the current one's a quiet tint of the primary. */
function Pill({ selected, children }: { selected: boolean; children: ReactNode }) {
  return (
    <span
      className={`flex h-8 w-tap-target shrink-0 items-center justify-center rounded-chip ${selected ? "bg-brand-tint" : ""}`}
    >
      {children}
    </span>
  );
}

/**
 * The menu from 1024 px wide: the lockup, then 기록, 홈 and 노트, the current one a tinted pill
 * behind its icon beside a bold label and the others muted, as the tab bar draws them, and at its
 * foot [profile], which opens 설정.
 */
export function SideMenu({ profile }: { profile?: ReactNode }) {
  return <SideMenuAt path={usePathname()} profile={profile} />;
}

/**
 * [SideMenu] at [path], or with no page current while the path is not yet known. Its column takes
 * the surface and the border down the page's whole height, and the menu inside it stays pinned in
 * view as the page scrolls (ADR 0038). The lockup, each item's pill and the profile's circle start
 * on the gutter, and the pill is the circle's width, so the labels start on one line too.
 */
export function SideMenuAt({ path, profile }: { path: string | null; profile?: ReactNode }) {
  return (
    <div className="hidden w-60 shrink-0 border-r border-hairline bg-surface lg:block">
      <nav
        aria-label="주 메뉴"
        className="sticky top-(--photo-import-bar,0px) flex h-[calc(100dvh-var(--photo-import-bar,0px))] flex-col gap-1.5 px-gutter py-7"
      >
        <Link
          href="/"
          aria-label="알아몰라, 홈"
          className={`mb-5 self-start rounded-field ${focus}`}
        >
          <BrandMark mark="lockup" alt="" className="h-7 w-auto" />
        </Link>
        {items.map(({ href, label, Icon, current }) => {
          const selected = path !== null && current(path);
          return (
            <Link
              key={href}
              href={href}
              aria-current={selected ? "page" : undefined}
              className={`pressable flex min-h-tap-target items-center gap-3 rounded-field text-label ${selected ? "text-accent" : "text-ink-2"} ${focus}`}
            >
              <Pill selected={selected}>
                <Icon aria-hidden className="size-5" strokeWidth={selected ? 2.2 : 2} />
              </Pill>
              {label}
            </Link>
          );
        })}
        {profile && <div className="mt-auto">{profile}</div>}
      </nav>
    </div>
  );
}

/** The menu below 1024 px wide: 기록, 홈 and 노트, their names alone, in a bar floating on its edge. */
export function TabBar() {
  return <TabBarAt path={usePathname()} />;
}

/** [TabBar] at [path], or with no page current while the path is not yet known. */
export function TabBarAt({ path }: { path: string | null }) {
  return (
    <nav
      aria-label="주 메뉴"
      className="fixed inset-x-4 bottom-4 z-10 grid min-h-tab-bar grid-cols-3 rounded-button bg-bar shadow-row lg:hidden"
    >
      {items.map(({ href, label, current }) => {
        const selected = path !== null && current(path);
        return (
          <Link
            key={href}
            href={href}
            aria-current={selected ? "page" : undefined}
            className={`pressable flex items-center justify-center rounded-button text-label ${selected ? "text-accent" : "text-ink-2"} ${focus} focus-visible:-outline-offset-2`}
          >
            <FittedLine className="text-center">{label}</FittedLine>
          </Link>
        );
      })}
    </nav>
  );
}
