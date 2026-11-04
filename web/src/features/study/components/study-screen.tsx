"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { v7 } from "uuid";

import { Mascot } from "@/design/brand";
import { buttonClass } from "@/design/button";

import type { Answer, AnswerWrite } from "../answer-write";
import { engineLoaded, loadEngine } from "../engine";
import { useCoach } from "../hooks/use-coach";
import { useLeave } from "../hooks/use-leave";
import { shortcut, useStudyKeys } from "../hooks/use-study-keys";
import { saveAnswer } from "../save-answer";
import { type SessionPlan, StudySession } from "../session";
import { WriteQueue } from "../write-queue";
import { AnswerButtons } from "./answer-buttons";
import { AnswerList } from "./answer-list";
import { CardDetail } from "./card-detail";
import { cardHeight } from "./card-height";
import { CompletionCard } from "./completion-card";
import { CurrentCard } from "./current-card";
import { GradedCard } from "./graded-card";
import { Hint } from "./key-hint";
import { LeaveConfirm } from "./leave-confirm";
import { PreviousPlaceholder } from "./previous-placeholder";
import { ShortcutHelp } from "./shortcut-help";
import { CoachCaption, CoachDemo, CoachSample, coachHighlight, coachSteps } from "./study-coach";
import { StudyHeader } from "./study-header";

/**
 * Whether the page is used by touch: then the screen is the phone's, answered and changed by the
 * cards' swipes with no answer button drawn, and its coach names those swipes.
 */
function touchFirst(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
}

/**
 * The study screen: the progress bar, and two cards of one size, the card answered just before,
 * its front over its back, above the current card, which shows its front alone, with the two
 * answer buttons under them where the page is used by a pointer. A click on the previous card
 * opens it whole; a touch swipe on it, Z or "마지막 응답 바꾸기" changes its answer. On a wide screen this session's answers are
 * listed beside, each a button that changes it. Once no card is left today the completion card
 * takes the current card's place, and the new cards past today's go on from it. Every action
 * shows at once; its write runs behind it, and a write that fails is shown with a retry while
 * its answer stays. Each action has a keyboard shortcut, listed by "단축키", and a visible
 * control. Every way out, the close, Esc and "그만하기", leaves for [back], where the session was
 * opened from.
 */
export function StudyScreen({
  plan,
  loading,
  back = "/",
}: {
  plan: SessionPlan;
  loading: ReactNode;
  back?: string;
}) {
  // The session places its cards through the engine's today's list, a synchronous call, so it
  // starts once the engine's module has loaded in the browser.
  const [engine, setEngine] = useState<"loading" | "ready" | "failed">(() =>
    engineLoaded() ? "ready" : "loading",
  );
  useEffect(() => {
    if (engine !== "loading") return;
    loadEngine().then(
      () => {
        setEngine("ready");
      },
      () => {
        setEngine("failed");
      },
    );
  }, [engine]);
  if (engine === "failed") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-3xl items-center justify-center px-gutter">
        <div role="alert" className="flex flex-col gap-3 rounded-row bg-surface p-4">
          <p className="text-dont-know-text">
            학습 화면을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setEngine("loading");
              }}
              className={buttonClass("primary")}
            >
              다시 시도
            </button>
            <Link href={back} className={buttonClass("secondary")}>
              그만하기
            </Link>
          </div>
        </div>
      </main>
    );
  }
  if (engine === "loading") return loading;
  return <Session plan={plan} back={back} />;
}

/** The study screen over a session that has started, the engine loaded. */
function Session({ plan, back }: { plan: SessionPlan; back: string }) {
  const [session] = useState(() => new StudySession(plan, Date.now, () => v7()));
  const [writes] = useState(() => new WriteQueue(saveAnswer));
  const [view, setView] = useState(() => session.view());
  /** Whether the page is used by touch, read once as the session starts. */
  const [touch] = useState(touchFirst);
  const [helpOpen, setHelpOpen] = useState(false);
  /** Whether the previous card is open whole. */
  const [detailOpen, setDetailOpen] = useState(false);
  const previousButton = useRef<HTMLButtonElement>(null);
  const helpButton = useRef<HTMLButtonElement>(null);
  const closeLink = useRef<HTMLAnchorElement>(null);
  const status = useSyncExternalStore(writes.subscribe, writes.getStatus, writes.getStatus);
  const { leaving, exit, stay, go } = useLeave(writes, status.pending > 0);
  const [coach, setCoach] = useCoach(view.kind);
  /** Applies an action and queues its write. */
  function apply(write: AnswerWrite | null) {
    setView(session.view());
    if (write) writes.push(write);
  }
  /** Answers the current card, which ends the coach. */
  function answer(choice: Answer) {
    setCoach(null);
    apply(session.answer(choice));
  }
  function toggle(position: number) {
    apply(session.toggle(position));
  }
  function redecide(position: number, choice: Answer) {
    apply(session.redecide(position, choice));
  }
  function toggleLast() {
    apply(session.toggleLast());
  }
  function leave() {
    closeLink.current?.click();
  }
  function studyOn() {
    session.studyOn();
    setView(session.view());
  }
  function closeHelp() {
    setHelpOpen(false);
    helpButton.current?.focus();
  }
  function closeDetail() {
    setDetailOpen(false);
    previousButton.current?.focus();
  }

  useStudyKeys((event) => {
    if (leaving !== null) {
      if (event.key === "Escape") {
        event.preventDefault();
        stay();
      }
      return;
    }
    if (helpOpen) {
      if (event.key === "Escape" || event.key === "?") {
        event.preventDefault();
        closeHelp();
      }
      return;
    }
    if (detailOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDetail();
      }
      return;
    }
    const action = shortcut(event, view.kind === "studying", view.previous.length > 0);
    if (!action) return;
    event.preventDefault();
    switch (action) {
      case "help":
        setHelpOpen(true);
        break;
      case "leave":
        leave();
        break;
      case "know":
      case "dontKnow":
        answer(action);
        break;
      case "toggleLast":
        toggleLast();
        break;
    }
  });

  // An answer counts only the time the page is visible.
  useEffect(() => {
    const listener = () => {
      if (document.visibilityState === "hidden") session.pause();
      else session.resume();
    };
    listener();
    document.addEventListener("visibilitychange", listener);
    return () => {
      document.removeEventListener("visibilitychange", listener);
    };
  }, [session]);

  const newest = view.previous.at(-1);
  /** The card the previous card's place shows, which a click opens whole. */
  const shown = newest ?? view.earlier;
  const demo = coach === "know" || coach === "dontKnow" ? coach : null;
  // Keyed by the answers given, so each answer shows the next card as a new one, at rest,
  // rather than easing it in from where a swipe let go.
  const currentCard = view.kind === "studying" && (
    <CurrentCard key={view.previous.length} card={view.current} onAnswer={answer} />
  );
  const current: ReactNode =
    view.kind === "studying" ? (
      demo ? (
        <CoachDemo answer={demo} touch={touch}>
          {currentCard}
        </CoachDemo>
      ) : (
        currentCard
      )
    ) : view.kind === "complete" ? (
      <CompletionCard
        completion={view.completion}
        back={back}
        onStudyOn={view.more ? studyOn : null}
        onStop={(event) => {
          exit(event, back);
        }}
      />
    ) : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-6 px-gutter py-6">
      <StudyHeader
        back={back}
        exit={exit}
        closeLink={closeLink}
        size={session.size}
        view={view}
        helpButton={helpButton}
        openHelp={() => {
          setHelpOpen(true);
        }}
        coach={coach}
        touch={touch}
      />

      {status.failure !== null && (
        <div role="alert" className="flex flex-col gap-3 rounded-row bg-surface p-4">
          <p className="text-dont-know-text">{status.failure}</p>
          <button
            type="button"
            onClick={() => {
              writes.retry();
            }}
            className={`${buttonClass("primary")} self-start`}
          >
            다시 시도
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-center gap-7">
        <section
          aria-label="카드"
          className="flex min-w-0 flex-[999_1_520px] flex-col items-center gap-5 pt-5"
        >
          {view.kind === "empty" ? (
            <div className="flex w-full max-w-list flex-col items-stretch gap-4 py-16">
              <Mascot expression="sleepy" className="size-mascot-medium self-center" />
              <p className="text-center text-body text-muted">오늘은 학습할 카드가 없어요</p>
              <Link
                href={back}
                onClick={(event) => {
                  exit(event, back);
                }}
                className={`${buttonClass("primary", "cta")} mt-1`}
              >
                닫기
              </Link>
            </div>
          ) : (
            <>
              {/* Two rows of one height: the previous card's place and the current card. The
                  place holds the coach's sample in its last step; otherwise the card answered
                  last, or the day's last card from an earlier session, or while studying an
                  outline. */}
              <div className="grid w-full max-w-study auto-rows-fr gap-4">
                {/* One row the place's height, so a long card fits its face to it, stepping and
                    scrolling inside its border, rather than growing an auto row the place cuts. */}
                <div
                  className={`grid grid-rows-1 overflow-hidden ${cardHeight} motion-safe:transition-opacity ${demo ? "opacity-45" : ""}`}
                >
                  {view.kind === "studying" && coach === "redecide" ? (
                    <CoachSample touch={touch} />
                  ) : newest ? (
                    <GradedCard
                      key={newest.position}
                      answer={newest}
                      openRef={previousButton}
                      onOpen={() => {
                        setDetailOpen(true);
                      }}
                      onRedecide={(choice) => {
                        redecide(newest.position, choice);
                      }}
                    />
                  ) : view.earlier ? (
                    <GradedCard
                      answer={view.earlier}
                      label="지난번 마지막 카드"
                      openRef={previousButton}
                      onOpen={() => {
                        setDetailOpen(true);
                      }}
                    />
                  ) : view.kind === "studying" ? (
                    <PreviousPlaceholder />
                  ) : (
                    <div aria-hidden />
                  )}
                </div>
                {current}
              </div>
              {view.kind === "studying" && (
                <div className="flex w-full max-w-study flex-col gap-3">
                  {coach && (
                    <CoachCaption
                      step={coach}
                      touch={touch}
                      onPrevious={() => {
                        setCoach(coachSteps[coachSteps.indexOf(coach) - 1] ?? coach);
                      }}
                      onNext={() => {
                        setCoach(coachSteps[coachSteps.indexOf(coach) + 1] ?? null);
                      }}
                    />
                  )}
                  {/* By touch the caption takes the controls' row, as on the phone; with a
                      pointer the controls stay under it, and its step marks the one it names. */}
                  {!(coach && touch) && (
                    <AnswerButtons
                      touch={touch}
                      highlight={coach}
                      onAnswer={answer}
                      onGuide={() => {
                        setCoach("know");
                      }}
                    />
                  )}
                </div>
              )}
              {/* Under the cards it acts on, in their column. By touch the previous card's swipe
                  changes it, as on the phone, so the button is left to screen readers; with a
                  pointer the coach's last step shows it before any answer. */}
              {(view.previous.length > 0 || (coach === "redecide" && !touch)) && (
                <button
                  type="button"
                  onClick={toggleLast}
                  aria-keyshortcuts="Z"
                  className={
                    touch
                      ? "sr-only"
                      : `${buttonClass("secondary")} ${coach === "redecide" ? coachHighlight : ""}`
                  }
                >
                  마지막 응답 바꾸기 <Hint>Z</Hint>
                </button>
              )}
            </>
          )}
        </section>

        {view.previous.length > 0 && <AnswerList answers={view.previous} onToggle={toggle} />}
      </div>

      {helpOpen && <ShortcutHelp onClose={closeHelp} />}
      {leaving !== null && (
        <LeaveConfirm
          count={status.pending}
          onStay={stay}
          onLeave={() => {
            go(leaving);
          }}
        />
      )}
      {detailOpen && shown && <CardDetail answer={shown} onClose={closeDetail} />}
    </main>
  );
}
