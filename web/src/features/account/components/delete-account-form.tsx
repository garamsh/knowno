"use client";

import { useState, useTransition } from "react";

import { Confirm } from "@/design/confirm";

import { deleteAccount } from "../actions";

/**
 * The "계정 삭제" row, in red, which asks first: the phone's title and sentence, "취소" and, last,
 * a red "삭제", "삭제 중" while it runs. On a store plan it adds that deleting does not cancel the subscription, with no
 * button to manage it, since the web cannot open the store. A failure is said in the dialog,
 * which stays open; while the deletion runs, "삭제" shows progress and cannot be pressed again.
 */
export function DeleteAccountForm({ storePlan }: { storePlan: boolean }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="pressable flex min-h-button items-center justify-between gap-3 rounded-b-group px-4 py-3 text-left text-body-strong text-dont-know-text focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink"
      >
        계정 삭제
      </button>
      {open && (
        <Confirm
          title="계정을 삭제할까요?"
          consequence="서버의 노트, 카드, 학습 기록이 모두 삭제되고, 다른 사람이 가져간 노트와 Google 계정은 남아요."
          confirmLabel={pending ? "삭제 중" : "삭제"}
          destructive
          pending={pending}
          close={() => {
            setOpen(false);
          }}
          onConfirm={() => {
            setError(null);
            start(async () => {
              const result = await deleteAccount();
              setError(result.error);
            });
          }}
        >
          {storePlan && (
            <p className="text-secondary text-ink-2">
              스토어 구독은 계정을 삭제해도 해지되지 않고, 스토어에서 해지하기 전까지 계속 결제돼요.
            </p>
          )}
          {error && (
            <p role="alert" className="text-secondary text-dont-know-text">
              {error}
            </p>
          )}
        </Confirm>
      )}
    </>
  );
}
