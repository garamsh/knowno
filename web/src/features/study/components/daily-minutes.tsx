"use client";

import { ChevronRight, Minus, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { FittedLine } from "@/design/fitted-line";
import { keepFocusInside } from "@/design/focus-trap";

import { saveDailyMinutes } from "../actions";
import { dailyMinuteStep, maxDailyMinutes, minDailyMinutes } from "../queue";
import { type MinutesPlan, minutesPreview } from "../study-time";

/**
 * The daily study minutes as the account page's row, "하루 학습 시간" with the minutes and a chevron,
 * which opens the dialog that changes them: the minutes as one large number between − and +, typed
 * in place when the number is pressed, two tiles of what they mean for the new cards by [plan], and
 * "저장", after which the page is read again.
 */
export function DailyMinutes({ minutes, plan }: { minutes: number; plan: MinutesPlan }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={`하루 학습 시간 ${String(minutes)}분`}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
        }}
        className="pressable flex min-h-button items-center justify-between gap-3 rounded-group px-4 py-3 text-left text-body-strong text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink"
      >
        하루 학습 시간
        <span className="flex items-center gap-1 text-secondary font-normal text-ink-2">
          {minutes}분
          <ChevronRight aria-hidden className="size-5" strokeWidth={2} />
        </span>
      </button>
      {open && (
        <MinutesDialog
          minutes={minutes}
          plan={plan}
          onClose={() => {
            setOpen(false);
            trigger.current?.focus();
          }}
        />
      )}
    </>
  );
}

function MinutesDialog({
  minutes: stored,
  plan,
  onClose,
}: {
  minutes: number;
  plan: MinutesPlan;
  onClose: () => void;
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState(stored);
  /** The minutes as typed while the number is edited; null otherwise. */
  const [typed, setTyped] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const number = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const less = useRef<HTMLButtonElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const editing = typed !== null;
  /** Whether the number takes the focus when it is shown: on opening, and after Enter ends an edit. */
  const refocus = useRef(true);
  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    } else if (refocus.current) {
      refocus.current = false;
      number.current?.focus();
    }
  }, [editing]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", listener);
    return () => {
      window.removeEventListener("keydown", listener);
    };
  }, [onClose]);

  const parsed = typed !== null && /^\d+$/.test(typed) ? Number(typed) : null;
  const typedMinutes =
    parsed !== null && parsed >= minDailyMinutes && parsed <= maxDailyMinutes ? parsed : null;
  const outOfRange = typed !== null && typed !== "" && typedMinutes === null;
  // The minutes the tiles show and 저장 saves: those typed, while within the bounds, or those chosen.
  const minutes = typedMinutes ?? chosen;

  /** Ends the edit: empty keeps the minutes, in the bounds sets them, outside keeps the field. */
  const commit = () => {
    if (outOfRange) return;
    if (typedMinutes !== null) setChosen(typedMinutes);
    setTyped(null);
    setMessage(null);
  };
  /**
   * Moves the minutes by [delta] within the bounds; when that disables the step pressed, the focus
   * moves to the other, so it is never disabled under the user.
   */
  const step = (delta: number) => {
    const next = Math.min(maxDailyMinutes, Math.max(minDailyMinutes, minutes + delta));
    const pressed = delta < 0 ? less.current : more.current;
    if (
      (next === minDailyMinutes || next === maxDailyMinutes) &&
      document.activeElement === pressed
    ) {
      (delta < 0 ? more.current : less.current)?.focus();
    }
    setChosen(next);
    setTyped(null);
    setMessage(null);
  };

  const { fresh, after } = minutesPreview(plan, minutes);
  const until =
    plan.unstarted === 0
      ? "새 카드를 모두 시작했어요"
      : after === null
        ? "이 시간은 복습으로 차서 새 카드는 시작하지 않아요"
        : after === 0
          ? "오늘"
          : `${String(after)}일 뒤`;
  const stepClass =
    "pressable flex size-button shrink-0 items-center justify-center rounded-full border border-outline text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-40";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-shadow/40 sm:items-center sm:px-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="daily-minutes-title"
        onKeyDown={keepFocusInside}
        aria-describedby="daily-minutes-body"
        className="flex max-h-[90dvh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-sheet bg-surface p-6 text-ink sm:rounded-sheet"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="daily-minutes-title" className="text-headline">
              하루 학습 시간
            </h2>
            <p id="daily-minutes-body" className="text-secondary text-muted">
              복습을 먼저 하고, 남는 시간에 새 카드를 시작해요.
            </p>
          </div>
          <button
            type="button"
            aria-label="닫기"
            onClick={onClose}
            className="pressable flex size-tap-target shrink-0 items-center justify-center rounded-full text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            <X aria-hidden className="size-5" strokeWidth={2} />
          </button>
        </div>
        {/* One height for the number and its input, so the row does not move when it is typed. */}
        <div className="flex h-18 items-center justify-between gap-3">
          <button
            ref={less}
            type="button"
            aria-label="5분 줄이기"
            disabled={minutes <= minDailyMinutes}
            onClick={() => {
              step(-dailyMinuteStep);
            }}
            className={stepClass}
          >
            <Minus aria-hidden className="size-5" strokeWidth={2} />
          </button>
          {!editing ? (
            <button
              ref={number}
              type="button"
              aria-label={`하루 ${String(chosen)}분, 눌러서 직접 입력`}
              onClick={() => {
                setTyped(String(chosen));
              }}
              className="pressable flex min-h-cta min-w-0 flex-1 items-center rounded-button focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              <FittedLine className="text-center">
                <span className="text-figure">{chosen}</span>
                <span className="ml-1 text-headline text-ink-2">분</span>
              </FittedLine>
            </button>
          ) : (
            <span className="flex flex-1 items-baseline justify-center gap-1">
              <input
                ref={input}
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={3}
                aria-label="하루 학습 시간(분)"
                aria-invalid={outOfRange}
                aria-describedby={outOfRange ? "daily-minutes-range" : undefined}
                value={typed}
                onChange={(event) => {
                  setTyped(event.target.value.replace(/\D/g, ""));
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    refocus.current = !outOfRange;
                    commit();
                  }
                }}
                onBlur={commit}
                className={`w-28 border-b-2 bg-transparent text-center text-figure focus:outline-none ${
                  outOfRange ? "border-dont-know-text text-dont-know-text" : "border-ink text-ink"
                }`}
              />
              <span className="text-headline text-ink-2">분</span>
            </span>
          )}
          <button
            ref={more}
            type="button"
            aria-label="5분 늘리기"
            disabled={minutes >= maxDailyMinutes}
            onClick={() => {
              step(dailyMinuteStep);
            }}
            className={stepClass}
          >
            <Plus aria-hidden className="size-5" strokeWidth={2} />
          </button>
        </div>
        {outOfRange && (
          <p id="daily-minutes-range" className="text-center text-caption text-dont-know-text">
            5분에서 180분 사이로 입력해 주세요
          </p>
        )}
        <div role="status" aria-live="polite" aria-atomic="true">
          {plan.backlog ? (
            <p className="rounded-row bg-brand-tint p-4 text-body-strong">
              밀린 복습을 마칠 때까지 새 카드는 쉬어요.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <p className="flex flex-col gap-1 rounded-row bg-brand-tint p-4">
                <span className="text-caption text-ink-2">하루 새 카드</span>
                <span className="text-body-strong">약 {fresh}장</span>
              </p>
              <p className="flex flex-col gap-1 rounded-row bg-brand-tint p-4">
                <span className="text-caption text-ink-2">새 카드 모두 시작</span>
                <span className="text-body-strong">{until}</span>
              </p>
            </div>
          )}
        </div>
        {message && (
          <p role="alert" className="text-caption text-dont-know-text">
            {message}
          </p>
        )}
        <button
          type="button"
          // A number outside the bounds is fixed before it is saved.
          disabled={saving || outOfRange}
          onClick={() => {
            startSaving(async () => {
              const result = await saveDailyMinutes(minutes);
              if (!result.saved) {
                setMessage(result.message);
                return;
              }
              onClose();
              router.refresh();
            });
          }}
          className="pressable flex min-h-cta items-center justify-center rounded-button bg-primary px-6 text-button text-on-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50"
        >
          {saving ? "저장 중" : "저장"}
        </button>
      </div>
    </div>
  );
}
