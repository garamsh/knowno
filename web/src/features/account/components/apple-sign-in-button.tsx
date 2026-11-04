"use client";

import { useRouter } from "next/navigation";
import Script from "next/script";
import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";

import { createClient } from "@/supabase/browser";

import {
  appleRedirectUri,
  appleScriptUrl,
  appleServicesId,
  createNonce,
  isAppleCancel,
  parseAppleSuccess,
  sha256Hex,
  signInWithApple,
} from "../apple-sign-in";

/** The part of Sign in with Apple JS's `AppleID.auth` this button uses. */
type AppleAuth = {
  init(config: {
    clientId: string;
    scope: string;
    redirectURI: string;
    nonce: string;
    usePopup: boolean;
  }): void;
  renderButton(): void;
};

declare global {
  interface Window {
    /** Set by Apple's script once it has loaded. */
    AppleID?: { auth: AppleAuth };
  }
}

const darkScheme = "(prefers-color-scheme: dark)";

/** Calls [onChange] whenever the page's theme may have changed: the choice or the system's. */
function subscribeToTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributeFilter: ["data-theme"] });
  const query = typeof window.matchMedia === "function" ? window.matchMedia(darkScheme) : null;
  query?.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    query?.removeEventListener("change", onChange);
  };
}

/** Whether the page is drawn dark: the choice on `<html>`, or the system's without one. */
function drawnDark(): boolean {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === "dark" || chosen === "light") return chosen === "dark";
  return typeof window.matchMedia === "function" && window.matchMedia(darkScheme).matches;
}

/**
 * Apple's "Sign in with Apple" button, rendered by Sign in with Apple JS from Apple's CDN
 * (ADR 0191): black in the light theme and white in the dark, as tall as Google's button and
 * rounded as it is. Apple's popup returns an identity token for the SHA-256 of a raw nonce, and
 * the raw nonce signs in to Supabase with it. A signed-in user opens `/`; a failure opens `/login`
 * with the reason `CallbackError` shows, ready for another sign-in; a cancelled popup is quiet.
 */
export function AppleSignInButton() {
  const dark = useSyncExternalStore(subscribeToTheme, drawnDark, () => false);
  const [state, setState] = useState<"loading" | "ready" | "pending" | "unavailable">("loading");
  const rawNonce = useRef("");
  const router = useRouter();

  /** Configures Apple's script with a new nonce, which draws its button. */
  function prepare() {
    const auth = window.AppleID?.auth;
    if (!auth) {
      setState("unavailable");
      return;
    }
    const nonce = createNonce();
    sha256Hex(nonce)
      .then((hashed) => {
        // The pair is set together, so the last nonce Apple was given is the one Supabase gets.
        rawNonce.current = nonce;
        auth.init({
          clientId: appleServicesId,
          scope: "name email",
          redirectURI: appleRedirectUri(window.location.origin),
          nonce: hashed,
          usePopup: true,
        });
        setState("ready");
      })
      .catch(() => {
        setState("unavailable");
      });
  }

  /** Shows [reason] under the buttons, as `/auth/callback` does, and readies another sign-in. */
  function fail(reason: "failed" | "suspended") {
    router.replace(`/login?error=${reason}`);
    prepare();
  }

  // Apple's popup answers with an event on the document.
  const succeeded = useEffectEvent((event: Event) => {
    const credential = event instanceof CustomEvent ? parseAppleSuccess(event.detail) : null;
    if (!credential) {
      fail("failed");
      return;
    }
    setState("pending");
    void signInWithApple(createClient().auth, credential, rawNonce.current)
      .catch(() => "failed" as const)
      .then((outcome) => {
        if (outcome === "signedIn") router.replace("/");
        else fail(outcome);
      });
  });
  const failed = useEffectEvent((event: Event) => {
    // Each sign-in draws its own nonce, as on the phone; a cancel shows nothing.
    if (event instanceof CustomEvent && isAppleCancel(event.detail)) prepare();
    else fail("failed");
  });
  useEffect(() => {
    function onSuccess(event: Event) {
      succeeded(event);
    }
    function onFailure(event: Event) {
      failed(event);
    }
    document.addEventListener("AppleIDSignInOnSuccess", onSuccess);
    document.addEventListener("AppleIDSignInOnFailure", onFailure);
    return () => {
      document.removeEventListener("AppleIDSignInOnSuccess", onSuccess);
      document.removeEventListener("AppleIDSignInOnFailure", onFailure);
    };
  }, []);

  useEffect(() => {
    // Apple's script reads data-color when it draws, so a theme change draws the button again.
    if (state === "ready") window.AppleID?.auth.renderButton();
  }, [dark, state]);

  return (
    <>
      <Script
        src={appleScriptUrl}
        onReady={prepare}
        onError={() => {
          setState("unavailable");
        }}
      />
      {/* Apple's script caps the button it draws inside at 375 px wide; it is centred there. */}
      <div
        hidden={state === "unavailable"}
        aria-busy={state === "pending"}
        className="aria-busy:pointer-events-none aria-busy:opacity-50"
      >
        <div
          id="appleid-signin"
          data-mode="center-align"
          data-type="sign-in"
          data-color={dark ? "white" : "black"}
          data-border="false"
          // A percentage of the height to Apple's script: 38% of h-cta's 64 px is rounded-button's 24.
          data-border-radius="38"
          className="flex h-cta w-full justify-center"
        />
      </div>
    </>
  );
}
