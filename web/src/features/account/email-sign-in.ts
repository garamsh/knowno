import type { AuthError } from "@supabase/supabase-js";

/**
 * What the email step knows after a send: the address the last code went to, when the next send is
 * allowed, counted from the send, and why a send did not go. `sent` counts the codes sent by this
 * form, so a resend to the same address is a new state.
 */
export type SendCodeState = {
  sent: number;
  email: string | null;
  resendIn: number | null;
  message: string | null;
};

/** The seconds before the next send, `auth.email.max_frequency` in production. */
export const resendSeconds = 60;

/**
 * What the email step and the code step show after an attempt that did not go on. The phone's
 * strings (ADR 0214) where it has them: `address`, `refused`, `wrongOrExpired` and the rate limit.
 * The web's own: `code` (the phone's button is off below six digits, the web's form is not),
 * `offline`, `unavailable` and `suspended`.
 */
export const emailMessages = {
  address: "이메일 주소를 확인해 주세요.",
  code: "6자리 숫자를 입력해 주세요.",
  offline: "연결할 수 없어요. 연결을 확인하고 다시 시도해 주세요.",
  unavailable: "지금은 코드를 보낼 수 없어요. 잠시 후 다시 시도해 주세요.",
  refused: "이 주소로는 코드를 보낼 수 없어요. 이메일 주소를 확인해 주세요.",
  wrongOrExpired: "코드가 맞지 않거나 만료됐어요. 다시 확인하거나 새 코드를 받아 주세요.",
  suspended: "이 계정은 이용이 정지됐어요. 문의는 sauce@garam.sh로 보내 주세요.",
} as const;

/** The sentence for a send refused for its rate: when the next one is allowed, if the server said. */
export function rateLimited(seconds: number | null): string {
  return seconds === null
    ? "요청이 너무 많아요. 잠시 뒤에 다시 시도해 주세요."
    : `요청이 너무 많아요. ${String(seconds)}초 뒤에 다시 시도해 주세요.`;
}

/** The longest address the server keeps, as RFC 5321 bounds a path. */
const maxAddressLength = 254;

/**
 * The address [value], which crossed the network, trimmed and lower-cased where it has the shape
 * of one: something, an `@`, and a dotted name with no space; null otherwise.
 */
export function parseEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const address = value.trim().toLowerCase();
  if (address.length > maxAddressLength) return null;
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(address) ? address : null;
}

/** How many digits the code has (`auth.email.otp_length`). */
export const codeLength = 6;

/** The code [value], with the spaces and hyphens a paste may carry removed, or null if not 6 digits. */
export function parseCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

/** Seconds the server asked to wait before another send, read from its sentence, or null. */
function waitSeconds(error: AuthError): number | null {
  const seconds = /(\d+)\s*seconds?/i.exec(error.message)?.[1];
  return seconds === undefined ? null : Number(seconds);
}

/** What a failed send or verification shows, and for a rate limit when the next send is allowed. */
export type EmailFailure = { message: string; resendIn: number | null };

/** The sentence for [error], an `AuthError` of a send or of a verification. */
export function emailFailure(error: AuthError): EmailFailure {
  const code: string = error.code ?? "";
  const status: number = error.status ?? 0;
  const failure = (message: string, resendIn: number | null = null) => ({ message, resendIn });
  if (code === "user_banned") return failure(emailMessages.suspended);
  if (
    code === "over_email_send_rate_limit" ||
    code === "over_request_rate_limit" ||
    status === 429
  ) {
    const seconds = waitSeconds(error);
    return failure(rateLimited(seconds), seconds);
  }
  if (code === "otp_expired") return failure(emailMessages.wrongOrExpired);
  if (
    code === "email_address_invalid" ||
    code === "email_address_not_authorized" ||
    code === "signup_disabled" ||
    code === "validation_failed"
  ) {
    return failure(emailMessages.refused);
  }
  // A request that never reached the server has no status; one it failed on has a 5xx.
  return failure(
    error.name === "AuthRetryableFetchError" && status === 0
      ? emailMessages.offline
      : emailMessages.unavailable,
  );
}
