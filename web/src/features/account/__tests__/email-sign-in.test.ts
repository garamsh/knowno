import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { emailFailure, emailMessages, parseCode, parseEmail, rateLimited } from "../email-sign-in";

describe("the address and the code, parsed at the boundary", () => {
  it("takes an address of the shape something@name.tld, trimmed and lower-cased", () => {
    expect(parseEmail("  Kim@Example.COM ")).toBe("kim@example.com");
    expect(parseEmail("a.b+c@mail.example.co.kr")).toBe("a.b+c@mail.example.co.kr");
  });

  it("refuses what is not one, and anything that is not text", () => {
    for (const value of [
      "",
      "kim",
      "kim@",
      "@example.com",
      "kim@example",
      "kim@@example.com",
      "k im@example.com",
      "kim@example..com",
      null,
      undefined,
      3,
      new File([], "a"),
    ]) {
      expect(parseEmail(value), `${typeof value} ${JSON.stringify(value)}`).toBeNull();
    }
    expect(parseEmail(`${"a".repeat(250)}@b.co`)).toBeNull();
    // Control: the same shape within the length is taken.
    expect(parseEmail(`${"a".repeat(200)}@b.co`)).not.toBeNull();
  });

  it("takes 6 digits, a pasted code's spaces and hyphens removed, and refuses the rest", () => {
    expect(parseCode("123456")).toBe("123456");
    expect(parseCode(" 123 456 ")).toBe("123456");
    expect(parseCode("123-456")).toBe("123456");
    for (const value of ["12345", "1234567", "12345a", "", "１２３４５６", null, 123456]) {
      expect(parseCode(value), String(value)).toBeNull();
    }
  });
});

describe("the sentence for each way a send or a verification fails", () => {
  const api = (message: string, status: number, code: string) =>
    emailFailure(new AuthApiError(message, status, code));

  it("says offline for a request that never reached the server, and unavailable for a server error", () => {
    expect(emailFailure(new AuthRetryableFetchError("fetch failed", 0)).message).toBe(
      emailMessages.offline,
    );
    expect(emailFailure(new AuthRetryableFetchError("bad gateway", 502)).message).toBe(
      emailMessages.unavailable,
    );
    expect(api("boom", 500, "unexpected_failure").message).toBe(emailMessages.unavailable);
  });

  it("says when the next send is allowed where the server named the wait", () => {
    expect(
      api(
        "For security purposes, you can only request this after 42 seconds.",
        429,
        "over_email_send_rate_limit",
      ),
    ).toEqual({ message: rateLimited(42), resendIn: 42 });
    // Control: a limit with no wait named says only to try later, and counts nothing down.
    expect(api("email rate limit exceeded", 429, "over_email_send_rate_limit")).toEqual({
      message: rateLimited(null),
      resendIn: null,
    });
    expect(rateLimited(42)).toContain("42초");
    expect(rateLimited(null)).not.toContain("초 뒤");
  });

  it("says a code is wrong or expired, which Supabase does not tell apart", () => {
    expect(api("Token has expired or is invalid", 403, "otp_expired").message).toBe(
      emailMessages.wrongOrExpired,
    );
  });

  it("says an address is refused for each way the server refuses one", () => {
    for (const code of [
      "email_address_invalid",
      "email_address_not_authorized",
      "signup_disabled",
      "validation_failed",
    ]) {
      expect(api("refused", 400, code).message, code).toBe(emailMessages.refused);
    }
  });

  it("says a suspended account is suspended", () => {
    expect(api("User is banned", 400, "user_banned").message).toBe(emailMessages.suspended);
  });
});

describe("the strings the phone has, word for word (ADR 0214)", () => {
  it("are the phone's for an address, a refused address, a refused code and a rate limit", () => {
    expect(emailMessages.address).toBe("이메일 주소를 확인해 주세요.");
    expect(emailMessages.refused).toBe(
      "이 주소로는 코드를 보낼 수 없어요. 이메일 주소를 확인해 주세요.",
    );
    expect(emailMessages.wrongOrExpired).toBe(
      "코드가 맞지 않거나 만료됐어요. 다시 확인하거나 새 코드를 받아 주세요.",
    );
    expect(rateLimited(42)).toBe("요청이 너무 많아요. 42초 뒤에 다시 시도해 주세요.");
    expect(rateLimited(null)).toBe("요청이 너무 많아요. 잠시 뒤에 다시 시도해 주세요.");
  });
});
