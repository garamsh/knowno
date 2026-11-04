import { createHash } from "node:crypto";

import { AuthError } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createNonce,
  isAppleCancel,
  parseAppleSuccess,
  sha256Hex,
  signInWithApple,
} from "../apple-sign-in";

function substituteAuth() {
  return {
    signInWithIdToken: vi.fn().mockResolvedValue({ data: {}, error: null }),
    updateUser: vi.fn().mockResolvedValue({ data: {}, error: null }),
  };
}

function bannedError() {
  return new AuthError("User is banned", 400, "user_banned");
}

describe("the nonce", () => {
  it("is 32 random bytes as hex, a new one each time", () => {
    const first = createNonce();
    const second = createNonce();

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toMatch(/^[0-9a-f]{64}$/);
    expect(second).not.toBe(first);
  });

  it("is given to Apple as its SHA-256 in hex", async () => {
    const nonce = createNonce();

    expect(await sha256Hex(nonce)).toBe(createHash("sha256").update(nonce).digest("hex"));
  });
});

describe("Apple's answer", () => {
  it("carries the identity token and, on a first sign-in, the name", () => {
    expect(
      parseAppleSuccess({
        authorization: { code: "c", id_token: "token", state: "" },
        user: { email: "a@b.c", name: { firstName: " 길동 ", lastName: "홍" } },
      }),
    ).toEqual({ idToken: "token", name: { given: "길동", family: "홍" } });
  });

  it("carries no name after the first sign-in", () => {
    expect(parseAppleSuccess({ authorization: { id_token: "token" } })).toEqual({
      idToken: "token",
      name: null,
    });
  });

  it("is no credential without an identity token", () => {
    expect(parseAppleSuccess({ authorization: { code: "c" } })).toBeNull();
    expect(parseAppleSuccess({ authorization: { id_token: "" } })).toBeNull();
    expect(parseAppleSuccess(null)).toBeNull();
  });

  it("is a cancel when the popup closed, Apple's Cancel was pressed or a new sign-in began, and a failure otherwise", () => {
    expect(isAppleCancel({ error: "popup_closed_by_user" })).toBe(true);
    expect(isAppleCancel({ error: "user_cancelled_authorize" })).toBe(true);
    expect(isAppleCancel({ error: "user_trigger_new_signin_flow" })).toBe(true);
    expect(isAppleCancel({ error: "popup_blocked_by_browser" })).toBe(false);
    expect(isAppleCancel(undefined)).toBe(false);
  });
});

describe("signInWithApple", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("signs in to Supabase with Apple's token and the raw nonce, and stores the name Apple shares", async () => {
    const auth = substituteAuth();

    const outcome = await signInWithApple(
      auth,
      { idToken: "token", name: { given: "길동", family: "홍" } },
      "raw",
    );

    expect(outcome).toBe("signedIn");
    expect(auth.signInWithIdToken).toHaveBeenCalledWith({
      provider: "apple",
      token: "token",
      nonce: "raw",
    });
    expect(auth.updateUser).toHaveBeenCalledWith({
      data: { full_name: "길동 홍", given_name: "길동", family_name: "홍" },
    });
  });

  it("asks for nothing more when Apple shares no name", async () => {
    const auth = substituteAuth();

    expect(await signInWithApple(auth, { idToken: "token", name: null }, "raw")).toBe("signedIn");
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("leaves the user signed in when the name cannot be stored, and logs it", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const auth = substituteAuth();
    auth.updateUser.mockResolvedValue({ data: {}, error: new AuthError("down", 503) });

    const name = { given: "길동", family: "" };
    expect(await signInWithApple(auth, { idToken: "token", name }, "raw")).toBe("signedIn");
    expect(auth.updateUser).toHaveBeenCalledWith({
      data: { full_name: "길동", given_name: "길동", family_name: "" },
    });
    expect(logged).toHaveBeenCalledTimes(1);

    auth.updateUser.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await signInWithApple(auth, { idToken: "token", name }, "raw")).toBe("signedIn");
    expect(logged).toHaveBeenCalledTimes(2);
  });

  it("is suspended when Supabase answers user_banned, and failed on another refusal", async () => {
    const auth = substituteAuth();
    auth.signInWithIdToken.mockResolvedValue({ data: {}, error: bannedError() });
    const credential = { idToken: "token", name: { given: "길동", family: "홍" } };

    expect(await signInWithApple(auth, credential, "raw")).toBe("suspended");

    auth.signInWithIdToken.mockResolvedValue({
      data: {},
      error: new AuthError("Nonces mismatch", 400, "bad_jwt"),
    });
    expect(await signInWithApple(auth, credential, "raw")).toBe("failed");
    // A refused sign-in stores nothing.
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
});
