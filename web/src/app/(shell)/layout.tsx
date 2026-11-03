import { Suspense } from "react";

import { ProfileButton, SideProfile } from "./_components/profile-button";
import { SideMenu, SideMenuAt, TabBar, TabBarAt } from "./_components/shell-menu";

/**
 * The signed-in pages' shell (ADR 0038, ADR 0165): from 1024 px wide a side menu beside the
 * content, the profile button at its foot; below it a tab bar at the foot, each page drawing its
 * own top, 홈's holding the profile button. The skip link leads past the menus to the page's
 * content.
 */
export default function ShellLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-20 focus:rounded-button focus:bg-surface focus:px-4 focus:py-3 focus:text-label focus:text-ink focus:outline-2 focus:outline-ink"
      >
        본문으로 건너뛰기
      </a>
      {/* The current page is read from the URL, which the static shell does not know. */}
      <Suspense fallback={<SideMenuAt path={null} />}>
        <SideMenu
          profile={
            <Suspense fallback={<ProfileButton initial={null} labelled />}>
              <SideProfile />
            </Suspense>
          }
        />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto flex w-full max-w-content flex-1 flex-col gap-5 px-gutter pt-6 pb-24 focus:outline-none lg:px-8 lg:pt-8 lg:pb-12"
        >
          {children}
        </main>
      </div>
      <Suspense fallback={<TabBarAt path={null} />}>
        <TabBar />
      </Suspense>
    </div>
  );
}
