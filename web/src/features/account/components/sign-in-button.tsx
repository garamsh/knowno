"use client";

import { LoaderCircle } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

import { createClient } from "@/supabase/browser";

/**
 * Google's "G" mark for the button of each theme: Google's own pixels, from its asset bundle
 * through app/assets/google/4.0x/, drawn at the guidelines' 20 px.
 */
function GoogleMark({ theme }: { theme: "light" | "dark" }) {
  return (
    <Image
      src={`/google/g-mark-${theme}.png`}
      alt=""
      width={80}
      height={80}
      unoptimized
      className={`size-google-mark shrink-0 ${theme === "light" ? "dark:hidden" : "hidden dark:block"}`}
    />
  );
}

/**
 * Google's "Sign in with Google" button, drawn to its branding guidelines (ADR 0024, ADR 0031):
 * the light button in the light theme and the dark one in the dark, with the "G" mark and a
 * localized label. It starts Google sign-in through Supabase Auth: the browser leaves for Google
 * and comes back to `/auth/callback` on this origin, which must be in Supabase Auth's allowed
 * redirect URLs.
 */
export function SignInButton() {
  const [state, setState] = useState<"idle" | "pending" | "failed">("idle");

  async function signIn() {
    setState("pending");
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    // On success the browser is already navigating to Google.
    if (error) setState("failed");
  }

  function start() {
    // A click handler's rejection reaches no error boundary, so it is shown here.
    signIn().catch(() => {
      setState("failed");
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={start}
        disabled={state === "pending"}
        aria-busy={state === "pending"}
        className="pressable flex min-h-cta items-center justify-center gap-google-gap rounded-button border border-google-stroke bg-google-fill ps-google-start pe-google-end text-google text-google-label focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50 font-google"
      >
        {state === "pending" ? (
          // Progress takes the mark's place while the browser leaves for Google.
          <LoaderCircle
            aria-hidden
            className="size-google-mark shrink-0 motion-safe:animate-spin"
            strokeWidth={2}
          />
        ) : (
          <>
            <GoogleMark theme="light" />
            <GoogleMark theme="dark" />
          </>
        )}
        Google로 로그인
      </button>
      {state === "failed" && (
        <p role="alert" className="text-caption text-dont-know-text">
          로그인을 시작하지 못했어요. 다시 시도해 주세요.
        </p>
      )}
    </div>
  );
}
