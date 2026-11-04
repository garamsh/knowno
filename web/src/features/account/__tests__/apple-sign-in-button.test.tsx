import { createHash } from "node:crypto";

import { AuthError } from "@supabase/supabase-js";
import { act, render, waitFor } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { testRouter } from "@/testing/router";

import { AppleSignInButton } from "../components/apple-sign-in-button";

// Apple's script is not loaded here: `next/script` reports it ready, or failed, at once, and
// `window.AppleID` is a substitute recording what the button asks of it.
let scriptLoads = true;
vi.mock("next/script", () => ({
  default: function Script({ onReady, onError }: { onReady?: () => void; onError?: () => void }) {
    // Once per mount, as next/script calls onReady.
    const called = useRef(false);
    useEffect(() => {
      if (called.current) return;
      called.current = true;
      if (scriptLoads) onReady?.();
      else onError?.();
    }, [onReady, onError]);
    return null;
  },
}));

const signInWithIdToken = vi.fn();
const updateUser = vi.fn();
vi.mock("@/supabase/browser", () => ({
  createClient: () => ({ auth: { signInWithIdToken, updateUser } }),
}));

const init = vi.fn();
const renderButton = vi.fn();

/** The wrapper Apple's script draws its button into, found by the id the script looks for. */
function appleButton() {
  const element = document.getElementById("appleid-signin");
  if (!element) throw new Error("no Apple button wrapper");
  return element;
}

/** The nonce Apple was given at its [call]th configuration. */
function hashedNonce(call: number): string {
  const config: unknown = init.mock.calls[call]?.[0];
  if (typeof config !== "object" || config === null || !("nonce" in config)) {
    throw new Error(`no configuration ${String(call)}`);
  }
  return String(config.nonce);
}

function answer(name: "AppleIDSignInOnSuccess" | "AppleIDSignInOnFailure", detail: unknown) {
  act(() => {
    document.dispatchEvent(new CustomEvent(name, { detail }));
  });
}

const token = { authorization: { code: "c", id_token: "apple-token", state: "" } };

describe("AppleSignInButton", () => {
  beforeEach(() => {
    scriptLoads = true;
    window.AppleID = { auth: { init, renderButton } };
    // The origin Apple is given its return URL on; the page navigates through the test router.
    vi.stubGlobal("location", { origin: "https://admin.knowno.app" });
    signInWithIdToken.mockResolvedValue({ data: {}, error: null });
    updateUser.mockResolvedValue({ data: {}, error: null });
  });

  afterEach(() => {
    delete window.AppleID;
    delete document.documentElement.dataset.theme;
    vi.unstubAllGlobals();
    for (const fake of [init, renderButton, signInWithIdToken, updateUser]) fake.mockReset();
  });

  it("opens Apple's popup for the Services ID, the name and email and this host's /login, and signs in with the nonce whose SHA-256 Apple got", async () => {
    render(<AppleSignInButton />);
    await waitFor(() => {
      expect(init).toHaveBeenCalledTimes(1);
    });
    expect(init).toHaveBeenCalledWith({
      clientId: "app.knowno.web",
      scope: "name email",
      redirectURI: "https://admin.knowno.app/login",
      nonce: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
      usePopup: true,
    });

    answer("AppleIDSignInOnSuccess", token);

    await waitFor(() => {
      expect(testRouter.replace).toHaveBeenCalledWith("/");
    });
    expect(signInWithIdToken).toHaveBeenCalledTimes(1);
    const sent: unknown = signInWithIdToken.mock.calls[0]?.[0];
    expect(sent).toMatchObject({ provider: "apple", token: "apple-token" });
    if (typeof sent !== "object" || sent === null || !("nonce" in sent))
      throw new Error("no nonce");
    const raw = String(sent.nonce);
    expect(createHash("sha256").update(raw).digest("hex")).toBe(hashedNonce(0));
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("is Apple's sign-in button, black in the light theme and white in the dark, drawn again when the theme changes", async () => {
    document.documentElement.dataset.theme = "dark";
    render(<AppleSignInButton />);
    await waitFor(() => {
      expect(init).toHaveBeenCalled();
    });

    expect(appleButton()).toHaveAttribute("data-type", "sign-in");
    expect(appleButton()).toHaveAttribute("data-color", "white");
    expect(appleButton()).toHaveAttribute("data-border", "false");
    const drawn = renderButton.mock.calls.length;

    act(() => {
      document.documentElement.dataset.theme = "light";
    });

    await waitFor(() => {
      expect(appleButton()).toHaveAttribute("data-color", "black");
    });
    expect(renderButton.mock.calls.length).toBeGreaterThan(drawn);
  });

  it("stays quiet with a new nonce when the popup is closed, and reports any other failure", async () => {
    render(<AppleSignInButton />);
    await waitFor(() => {
      expect(init).toHaveBeenCalledTimes(1);
    });

    answer("AppleIDSignInOnFailure", { error: "popup_closed_by_user" });

    await waitFor(() => {
      expect(init).toHaveBeenCalledTimes(2);
    });
    expect(hashedNonce(1)).not.toBe(hashedNonce(0));
    expect(testRouter.replace).not.toHaveBeenCalled();
    expect(appleButton().parentElement).toBeVisible();

    answer("AppleIDSignInOnFailure", { error: "popup_blocked_by_browser" });

    expect(testRouter.replace).toHaveBeenCalledWith("/login?error=failed");
  });

  it("opens /login with the suspended account's reason on user_banned, and the failure's on another refusal", async () => {
    render(<AppleSignInButton />);
    await waitFor(() => {
      expect(init).toHaveBeenCalled();
    });

    signInWithIdToken.mockResolvedValueOnce({
      data: {},
      error: new AuthError("User is banned", 400, "user_banned"),
    });
    answer("AppleIDSignInOnSuccess", token);
    await waitFor(() => {
      expect(testRouter.replace).toHaveBeenCalledWith("/login?error=suspended");
    });

    signInWithIdToken.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    answer("AppleIDSignInOnSuccess", token);
    await waitFor(() => {
      expect(testRouter.replace).toHaveBeenLastCalledWith("/login?error=failed");
    });
  });

  it("stores the name Apple shares on a first sign-in", async () => {
    render(<AppleSignInButton />);
    await waitFor(() => {
      expect(init).toHaveBeenCalled();
    });

    answer("AppleIDSignInOnSuccess", {
      ...token,
      user: { email: "a@b.c", name: { firstName: "길동", lastName: "홍" } },
    });

    await waitFor(() => {
      expect(testRouter.replace).toHaveBeenCalledWith("/");
    });
    expect(updateUser).toHaveBeenCalledWith({
      data: { full_name: "길동 홍", given_name: "길동", family_name: "홍" },
    });
  });

  it("cannot be pressed again while Supabase signs in", async () => {
    signInWithIdToken.mockReturnValue(new Promise(() => undefined));
    render(<AppleSignInButton />);
    await waitFor(() => {
      expect(init).toHaveBeenCalled();
    });
    expect(appleButton().parentElement).toHaveAttribute("aria-busy", "false");

    answer("AppleIDSignInOnSuccess", token);

    expect(appleButton().parentElement).toHaveAttribute("aria-busy", "true");
    expect(appleButton().parentElement).toHaveClass("aria-busy:pointer-events-none");
  });

  it("is not shown when Apple's script cannot be loaded", () => {
    scriptLoads = false;
    render(<AppleSignInButton />);

    expect(appleButton().parentElement).not.toBeVisible();
    expect(init).not.toHaveBeenCalled();
  });
});
