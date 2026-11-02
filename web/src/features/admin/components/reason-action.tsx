"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";

import type { ActionResult } from "../action-call";
import { button, field as fieldStyle } from "./admin-section";

/**
 * An admin action that records a reason: [label] opens a field for the reason, then [question]
 * with "취소" to leave it and, last, [confirmLabel] to act, a red final button where the action
 * is [final], cannot be undone; the action's sentence shows after.
 */
export function ReasonAction({
  label,
  reasonLabel,
  question,
  confirmLabel,
  final = false,
  compact = false,
  action,
}: {
  label: string;
  reasonLabel: string;
  question: string;
  confirmLabel: string;
  final?: boolean;
  /** Whether it sits in a row or a menu, drawn a tap target high. */
  compact?: boolean;
  action: (reason: string) => Promise<ActionResult>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const field = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);

  return (
    <div className="flex flex-col gap-2">
      {open ? (
        <div
          role="group"
          aria-label={question}
          className="flex flex-col gap-3 rounded-group border border-outline bg-surface p-4"
        >
          <label htmlFor={id} className="text-section text-muted">
            {reasonLabel}
          </label>
          <textarea
            id={id}
            ref={field}
            value={reason}
            maxLength={500}
            rows={2}
            onChange={(event) => {
              setReason(event.target.value);
            }}
            className={`${fieldStyle} bg-ground p-3`}
          />
          <p className="text-body-strong">{question}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setOpen(false);
              }}
              className={button.secondary}
            >
              취소
            </button>
            <button
              type="button"
              disabled={pending || reason.trim() === ""}
              onClick={() => {
                startTransition(async () => {
                  const result = await action(reason);
                  setMessage(result.message);
                  if (result.changed) {
                    setOpen(false);
                    setReason("");
                  }
                });
              }}
              className={final ? button.destructiveFinal : button.primary}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setMessage(null);
            setOpen(true);
          }}
          className={
            compact
              ? final
                ? button.rowDestructive
                : button.row
              : final
                ? button.destructive
                : button.secondary
          }
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
