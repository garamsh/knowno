"use client";

import { ChartColumn, Layers, type LucideIcon, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { BrandMark } from "@/design/brand";

/** A page the menus open, and whether a path is that page or below it. */
type Item = { href: string; label: string; Icon: LucideIcon; current: (path: string) => boolean };

const items: readonly Item[] = [
  { href: "/", label: "오늘", Icon: Sun, current: (path) => path === "/" },
  { href: "/decks", label: "덱", Icon: Layers, current: (path) => path.startsWith("/decks") },
  {
    href: "/record",
    label: "기록",
    Icon: ChartColumn,
    current: (path) => path.startsWith("/record"),
  },
];

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

/** The place of a menu item's icon, the current one's a quiet tint of the primary. */
function Pill({ selected, children }: { selected: boolean; children: ReactNode }) {
  return (
    <span
      className={`flex h-8 w-14 shrink-0 items-center justify-center rounded-chip ${selected ? "bg-brand-tint" : ""}`}
    >
      {children}
    </span>
  );
}

/**
 * The menu from 1024 px wide: the lockup, 오늘, 덱 and 기록, the current one a tinted pill
 * behind its icon beside a bold label and the others muted, as the tab bar draws them, and
 * [account], the account's link, at its foot.
 */
export function SideMenu({ account }: { account: ReactNode }) {
  return <SideMenuAt path={usePathname()} account={account} />;
}

/**
 * [SideMenu] at [path], or with no page current while the path is not yet known. Its column takes
 * the surface and the border down the page's whole height, and the menu inside it stays pinned in
 * view as the page scrolls (ADR 0038).
 */
export function SideMenuAt({ path, account }: { path: string | null; account: ReactNode }) {
  return (
    <div className="hidden w-60 shrink-0 border-r border-hairline bg-surface lg:block">
      <nav aria-label="주 메뉴" className="sticky top-0 flex h-dvh flex-col gap-1.5 px-4 py-7">
        <Link
          href="/"
          aria-label="알아몰라, 오늘"
          className={`mx-2.5 mb-5 self-start rounded-field ${focus}`}
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
              className={`pressable flex min-h-tap-target items-center gap-3 rounded-field px-1 text-label ${selected ? "text-accent" : "text-ink-2"} ${focus}`}
            >
              <Pill selected={selected}>
                <Icon aria-hidden className="size-5" strokeWidth={selected ? 2.2 : 2} />
              </Pill>
              {label}
            </Link>
          );
        })}
        <span className="min-h-4 flex-1" />
        {account}
      </nav>
    </div>
  );
}

/** The menu below 1024 px wide: 오늘, 덱 and 기록, their names alone, in a bar floating on its edge. */
export function TabBar() {
  return <TabBarAt path={usePathname()} />;
}

/** [TabBar] at [path], or with no page current while the path is not yet known. */
export function TabBarAt({ path }: { path: string | null }) {
  return (
    <nav
      aria-label="주 메뉴"
      className="fixed inset-x-4 bottom-4 z-10 grid min-h-tab-bar grid-cols-3 rounded-button bg-surface shadow-row lg:hidden"
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
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
