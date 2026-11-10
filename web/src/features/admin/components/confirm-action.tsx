"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import type { ActionResult } from "../action-call";
import { button } from "./admin-section";

/**
 * An admin action behind a confirmation: [label] asks [question], with "취소" to leave it and,
 * last, [confirmLabel] to act; the action's sentence then shows in a status region. The server
 * checks the role, so this only spares a slip of the finger.
 */
export function ConfirmAction({
  label,
  question,
  confirmLabel,
  action,
  compact = false,
  primary,
  disabled = false,
}: {
  label: string;
  question: string;
  confirmLabel: string;
  action: () => Promise<ActionResult>;
  /** Whether there is nothing for it to do, so it cannot be pressed. */
  disabled?: boolean;
} & (
  | {
      /** Whether it sits in a row or a card, drawn as [button.row]. */
      compact?: boolean;
      primary?: never;
    }
  | {
      /** Whether it is the page's one primary, drawn as [button.primary]. */
      primary: true;
      compact?: never;
    }
)) {
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  return (
    <div className="flex flex-col gap-2">
      {confirming ? (
        <div
          role="group"
          aria-label={question}
          className="flex flex-col gap-3 rounded-group border border-outline bg-surface p-4"
        >
          <p className="text-body-strong">{question}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setConfirming(false);
              }}
              className={button.secondary}
            >
              취소
            </button>
            <button
              ref={confirmRef}
              type="button"
              disabled={pending}
              onClick={() => {
                startTransition(async () => {
                  const result = await action();
                  // After an await a state update is no longer part of the transition, so it
                  // would show the sentence before the page the action refreshed arrives.
                  startTransition(() => {
                    setMessage(result.message);
                    setConfirming(false);
                  });
                });
              }}
              className={button.primary}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setMessage(null);
            setConfirming(true);
          }}
          className={primary ? button.primary : compact ? button.row : button.secondary}
        >
          {label}
        </button>
      )}
      <p role="status" className="text-caption text-muted empty:hidden">
        {message}
      </p>
    </div>
  );
}
