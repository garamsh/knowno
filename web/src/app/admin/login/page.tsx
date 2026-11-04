import type { Metadata } from "next";
import { Suspense } from "react";

import { AppleSignInButton, CallbackError, SignInButton } from "@/features/account";
import { AdminBrand } from "@/features/admin";

export const metadata: Metadata = { title: "관리자 로그인 · 알아몰라" };

/**
 * The admin host's sign-in, `/login` there (ADR 0178): the brand over "관리", then Google's and
 * Apple's buttons, which sign in on this host alone, since its session cookies are not the
 * service's.
 * Whether the account is an admin is the server's to say once it is signed in.
 */
export default function AdminLoginPage({ searchParams }: PageProps<"/admin/login">) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-list flex-col justify-center gap-6 px-gutter py-10 break-keep">
      <AdminBrand named />
      <div className="flex flex-col gap-2">
        <h1 className="text-title">관리자 로그인</h1>
        <p className="text-body text-ink-2">
          관리자 계정으로 로그인해 주세요. 서비스의 로그인과는 따로예요.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <SignInButton />
        <AppleSignInButton />
        <Suspense>
          <CallbackError searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
