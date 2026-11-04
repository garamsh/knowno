"use client";

import { ChevronRight } from "lucide-react";
import { useId, useState, useTransition } from "react";

import { buttonClass } from "@/design/button";
import { Confirm } from "@/design/confirm";

import type { ActionResult } from "../action-call";
import { actionRow, button, field } from "./admin-section";

/**
 * An admin action asked first in the shared `Confirm` sheet: [label] opens [question] over
 * [consequence], with "취소" and, last, [confirmLabel]; with a [reasonLabel] the sheet asks for a
 * reason, and its confirm waits for one. The action's sentence then shows in a status region. It
 * is drawn as a [row] ending a group, with a chevron, as red text where it is [destructive], or as
 * quiet text.
 */
export function SheetConfirm({
  label,
  question,
  consequence,
  confirmLabel,
  reasonLabel,
  look,
  action,
}: {
  label: string;
  question: string;
  consequence: string;
  confirmLabel: string;
  reasonLabel?: string;
  look: "row" | "destructive" | "text";
  action: (reason: string) => Promise<ActionResult>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = useId();
  const looks = {
    row: actionRow,
    destructive: button.rowDestructive,
    text: `${buttonClass("text", "header")} w-fit self-start`,
  };
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => {
          setMessage(null);
          setReason("");
          setOpen(true);
        }}
        className={looks[look]}
      >
        {label}
        {look === "row" && <ChevronRight aria-hidden className="size-5 shrink-0 text-muted" />}
      </button>
      <p role="status" className="px-1 text-caption text-muted empty:hidden">
        {message}
      </p>
      {open && (
        <Confirm
          title={question}
          consequence={consequence}
          confirmLabel={confirmLabel}
          destructive={false}
          pending={pending || (reasonLabel !== undefined && reason.trim() === "")}
          onConfirm={() => {
            startTransition(async () => {
              const result = await action(reason);
              setMessage(result.message);
              setOpen(false);
            });
          }}
          close={() => {
            setOpen(false);
          }}
        >
          {reasonLabel !== undefined && (
            <div className="flex flex-col gap-2">
              <label htmlFor={id} className="text-section text-muted">
                {reasonLabel}
              </label>
              <textarea
                id={id}
                value={reason}
                maxLength={500}
                rows={2}
                onChange={(event) => {
                  setReason(event.target.value);
                }}
                className={`${field} bg-ground p-3`}
              />
            </div>
          )}
        </Confirm>
      )}
    </div>
  );
}
