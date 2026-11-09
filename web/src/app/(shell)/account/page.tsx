import type { Metadata } from "next";
import { Suspense } from "react";

import { ScreenSkeleton } from "@/design/screen-skeleton";
import { LegalLinks } from "@/features/legal";

import { Profile } from "./_components/profile";
import { ProfileSkeleton } from "./_components/profile-skeleton";

export const metadata: Metadata = { title: "설정 · 알아몰라" };

/**
 * 설정, as the phone's settings screen: the account with sign-out, the study settings and the
 * theme, each section one group, then the legal links, muted on one line at its foot.
 */
export default function AccountPage() {
  return (
    <div className="flex w-full max-w-list flex-1 flex-col">
      <ScreenSkeleton title="설정" topLevel>
        <Suspense fallback={<ProfileSkeleton />}>
          <Profile />
        </Suspense>
        <footer className="mt-auto pt-8">
          <LegalLinks />
        </footer>
      </ScreenSkeleton>
    </div>
  );
}
