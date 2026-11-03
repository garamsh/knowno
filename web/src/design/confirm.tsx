"use client";

import { type ReactNode, useEffect, useRef } from "react";

import { buttonClass } from "./button";
import { Sheet } from "./sheet";

/**
 * The question before an action, as the phone's `showAppConfirm`: the [title] asks it, the
 * [consequence] states in one sentence what it does, over [children] such as why it failed, then
 * the cancel, "취소" unless [cancelLabel] names it, focused first, and, last, [confirmLabel] — the
 * red final button where the action is [destructive], the primary otherwise. A click on the
 * scrim, Escape, "닫기" and the browser's back cancel, as the cancel does.
 */
export function Confirm({
  title,
  consequence,
  confirmLabel,
  destructive,
  cancelLabel = "취소",
  pending = false,
  children,
  onConfirm,
  close,
}: {
  title: string;
  consequence: string;
  confirmLabel: string;
  destructive: boolean;
  cancelLabel?: string;
  /** While true, the confirm button is disabled, as one press is under way. */
  pending?: boolean;
  children?: ReactNode;
  onConfirm: () => void;
  close: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  // After the sheet's own effect has opened it, which focuses its first control.
  useEffect(() => {
    cancel.current?.focus();
  }, []);
  return (
    <Sheet title={title} close={close}>
      <p className="text-secondary break-keep text-muted">{consequence}</p>
      {children}
      <div className="mt-4 flex flex-col gap-2">
        <button
          ref={cancel}
          type="button"
          onClick={close}
          className={buttonClass("secondary", "cta")}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={onConfirm}
          className={buttonClass(destructive ? "destructiveFinal" : "primary", "cta")}
        >
          {confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}
