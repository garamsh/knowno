"use client";

import { LoaderCircle } from "lucide-react";
import { useActionState, useEffect, useState } from "react";

import { buttonClass } from "@/design/button";

import { sendEmailCode, verifyEmailCode } from "../actions";
import { codeLength, type SendCodeState } from "../email-sign-in";
import type { VerifyCodeState } from "../verify-email-code";

const field =
  "min-h-field w-full rounded-field border border-outline bg-surface px-4 py-3 text-body text-ink placeholder:text-muted focus:outline-2 focus:outline-ink";

// The server's render hands back the initial state it is given, so each is one object: a new one
// every render would be taken for a change, and the render would not end.
const nothingSent: SendCodeState = { sent: 0, email: null, resendIn: null, message: null };
const nothingSaid: VerifyCodeState = { message: null };

/**
 * The third way to sign in, beside Google's and Apple's (ADR 0215): "이메일로 계속하기" opens the
 * email step, which sends a 6-digit code; the code step takes it, offers a resend once the interval
 * has passed, shown as a countdown, and a way back to change the address. Both steps are Server
 * Actions, so the session is set as cookies on the host that asked.
 */
export function EmailSignIn() {
  const [open, setOpen] = useState(false);
  const [backedAt, setBackedAt] = useState(0);
  const [sent, send, sending] = useActionState<SendCodeState, FormData>(sendEmailCode, nothingSent);
  const [verified, verify, verifying] = useActionState(verifyEmailCode, nothingSaid);
  // Each send, and each refusal that names a wait, starts the countdown over.
  const [left, setLeft] = useState(0);
  const [lastSeen, setLastSeen] = useState<SendCodeState | null>(null);
  if (sent !== lastSeen) {
    setLastSeen(sent);
    if (sent.resendIn !== null) setLeft(sent.resendIn);
  }
  const counting = left > 0;
  useEffect(() => {
    if (!counting) return;
    const timer = window.setInterval(() => {
      setLeft((now) => Math.max(0, now - 1));
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [counting]);
  const inCode = sent.email !== null && sent.sent > backedAt;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className={`${buttonClass("secondary")} w-full max-w-sign-in self-center border border-outline`}
      >
        이메일로 계속하기
      </button>
    );
  }

  if (!inCode) {
    return (
      <form
        action={send}
        aria-label="이메일로 계속하기"
        className="flex w-full max-w-sign-in flex-col gap-3 self-center"
      >
        <label className="flex flex-col gap-2 text-body text-ink-2">
          이메일 주소
          <input
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            defaultValue={sent.email ?? ""}
            placeholder="name@example.com"
            className={field}
          />
        </label>
        <button
          type="submit"
          disabled={sending}
          aria-busy={sending}
          className={`${buttonClass("primary")} gap-2`}
        >
          코드 받기
          {sending && <LoaderCircle aria-hidden className="size-5 motion-safe:animate-spin" />}
        </button>
        {sent.message !== null && (
          <p role="alert" className="text-caption text-dont-know-text">
            {sent.message}
          </p>
        )}
      </form>
    );
  }

  return (
    <div className="flex w-full max-w-sign-in flex-col gap-3 self-center">
      <form action={verify} aria-label="인증 코드" className="flex flex-col gap-3">
        <input type="hidden" name="email" value={sent.email ?? ""} />
        <label className="flex flex-col gap-2 text-body text-ink-2">
          <span className="break-words">
            {sent.email}로 보낸 {String(codeLength)}자리 코드를 입력해 주세요.
          </span>
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            autoFocus
            aria-label="인증 코드"
            placeholder="000000"
            className={`${field} text-center tracking-widest tabular-nums`}
          />
        </label>
        <button
          type="submit"
          disabled={verifying}
          aria-busy={verifying}
          className={`${buttonClass("primary")} gap-2`}
        >
          확인
          {verifying && <LoaderCircle aria-hidden className="size-5 motion-safe:animate-spin" />}
        </button>
        {verified.message !== null && (
          <p role="alert" className="text-caption text-dont-know-text">
            {verified.message}
          </p>
        )}
      </form>
      <form action={send} className="flex flex-col gap-2">
        <input type="hidden" name="email" value={sent.email ?? ""} />
        <button
          type="submit"
          disabled={sending || counting}
          className={buttonClass("text", "header")}
        >
          {counting ? `코드 다시 받기 (${String(left)}초)` : "코드 다시 받기"}
        </button>
        {sent.message !== null && (
          <p role="alert" className="text-caption text-dont-know-text">
            {sent.message}
          </p>
        )}
      </form>
      <button
        type="button"
        onClick={() => {
          setBackedAt(sent.sent);
        }}
        className={buttonClass("text", "header")}
      >
        이메일 바꾸기
      </button>
    </div>
  );
}
