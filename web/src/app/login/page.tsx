import type { Metadata } from "next";
import { Suspense } from "react";

import { BrandMark } from "@/design/brand";
import { LegalLinks } from "@/features/legal";
import { AppleSignInButton, CallbackError, SignInButton } from "@/features/account";

export const metadata: Metadata = { title: "로그인 · 알아몰라" };

/**
 * The sign-in page, the only page a signed-out visitor can open, as the phone's welcome draws
 * it: the stacked logo and what the app does on the ground's panel, then Google's and Apple's buttons and
 * the terms the user agrees to.
 */
export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex min-h-dvh flex-col bg-surface">
      <div className="flex flex-1 flex-col items-center justify-center gap-6 rounded-b-panel bg-ground px-gutter py-10 text-center">
        <h1>
          <BrandMark mark="stacked" alt="알아몰라" className="h-auto w-stacked-lockup-width" />
        </h1>
        <p className="text-body whitespace-pre-line text-ink-2">
          {"밀어서 응답하고,\n잊을 때쯤 다시 만나는 암기 카드"}
        </p>
      </div>
      <div className="mx-auto flex w-full max-w-list flex-col gap-4 px-gutter pt-8 pb-4">
        <div className="flex flex-col gap-3">
          <SignInButton />
          <AppleSignInButton />
          <Suspense>
            <CallbackError searchParams={searchParams} />
          </Suspense>
        </div>
        <div className="flex flex-col text-center">
          <p className="text-caption text-muted">
            계속하면 이용약관과 개인정보 처리방침에 동의하는 것으로 봐요.
          </p>
          <LegalLinks />
        </div>
      </div>
    </main>
  );
}
