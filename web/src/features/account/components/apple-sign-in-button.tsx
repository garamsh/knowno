"use client";

import { useRouter } from "next/navigation";
import Script from "next/script";
import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";

import { createClient } from "@/supabase/browser";

import {
  appleRedirectUri,
  appleScriptUrl,
  appleServicesId,
  drawNoncePair,
  isAppleCancel,
  parseAppleSuccess,
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
  // The nonce pair Apple is configured with, kept until a sign-in spends its token: Apple's
  // script builds a popup from the nonce it was last given, and a press that replaces an open
  // popup reports the old one closed after the new one has taken that nonce.
  const pair = useRef<Promise<{ raw: string; hashed: string }> | null>(null);
  const router = useRouter();

  /** Configures Apple's script with the current nonce pair, drawing one if none is kept. */
  function prepare() {
    const auth = window.AppleID?.auth;
    if (!auth) {
      setState("unavailable");
      return;
    }
    pair.current ??= drawNoncePair();
    pair.current
      .then(({ hashed }) => {
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
        pair.current = null;
        setState("unavailable");
      });
  }

  /** Spends the kept pair on one sign-in and readies the next with a new one. */
  async function spendNonce(): Promise<string> {
    const spent = pair.current;
    pair.current = null;
    if (!spent) throw new Error("Apple answered before a nonce was drawn");
    return (await spent).raw;
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
    void spendNonce()
      .then((rawNonce) => signInWithApple(createClient().auth, credential, rawNonce))
      .catch(() => "failed" as const)
      .then((outcome) => {
        if (outcome === "signedIn") router.replace("/");
        else fail(outcome);
      });
  });
  const failed = useEffectEvent((event: Event) => {
    // A cancel shows nothing and keeps the nonce, which the popup replacing it may carry.
    if (!(event instanceof CustomEvent && isAppleCancel(event.detail))) fail("failed");
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
      {/* As wide as Google's button: the column, up to the widest Apple's script draws, centred. */}
      <div
        hidden={state === "unavailable"}
        aria-busy={state === "pending"}
        className="w-full max-w-sign-in self-center aria-busy:pointer-events-none aria-busy:opacity-50"
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
