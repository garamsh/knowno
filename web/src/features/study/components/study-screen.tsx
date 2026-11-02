"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type MouseEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { v7 } from "uuid";

import { Mascot } from "@/design/brand";
import { Chip } from "@/design/chip";

import type { Answer, AnswerWrite } from "../answer-write";
import { engineLoaded, loadEngine } from "../engine";
import { saveAnswer } from "../save-answer";
import { type PreviousAnswer, type SessionPlan, StudySession } from "../session";
import { useSwipe } from "../hooks/use-swipe";
import { WriteQueue } from "../write-queue";
import { AnswerList } from "./answer-list";
import { CardDetail } from "./card-detail";
import { cardHeight } from "./card-height";
import { CardScroll } from "./card-scroll";
import { CardSide } from "./card-side";
import { CompletionCard } from "./completion-card";
import { LeaveConfirm } from "./leave-confirm";
import { PreviousPlaceholder } from "./previous-placeholder";
import { answerTints, GradedCard, grades, tiltPerPixel } from "./graded-card";
import { ShortcutHelp } from "./shortcut-help";
import { SoundControls } from "./sound-controls";
import {
  CoachCaption,
  CoachDemo,
  CoachSample,
  coachAnnouncement,
  type CoachStep,
  coachShownKey,
  coachSteps,
} from "./study-coach";

const button =
  "pressable flex min-h-button items-center justify-center gap-2 rounded-button px-5 text-button focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50";

const quiet = `${button} bg-surface text-ink`;

/** A key hint beside a control's name, left out of the name screen readers announce. */
function Hint({ children }: { children: string }) {
  return (
    <kbd aria-hidden className="font-sans text-caption font-normal opacity-80">
      {children}
    </kbd>
  );
}

/** Whether a key press belongs to a field or a modifier shortcut, not to the study screen. */
function isForeign(event: KeyboardEvent): boolean {
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return true;
  const target = event.target;
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/** What a key press asks of the study screen, or null when it asks nothing it can do now. */
function shortcut(
  event: KeyboardEvent,
  studying: boolean,
  answered: boolean,
): "help" | "leave" | "know" | "dontKnow" | "toggleLast" | null {
  if (event.key === "?") return "help";
  if (event.key === "Escape") return "leave";
  if (event.key === "ArrowRight") return studying ? "know" : null;
  if (event.key === "ArrowLeft") return studying ? "dontKnow" : null;
  // A letter by its physical key, so it works whatever the keyboard's input language.
  if (event.code === "KeyZ") return answered ? "toggleLast" : null;
  return null;
}

/** Whether the page is used by touch, so the coach names the swipe the cards take. */
function touchFirst(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
}

/** Whether the browser keeps that the coach has shown; where it keeps nothing, it has not. */
function coachShown(): boolean {
  try {
    return window.localStorage.getItem(coachShownKey) === "true";
  } catch {
    return false;
  }
}

/** Keeps in the browser that the coach has shown, where it keeps anything. */
function markCoachShown() {
  try {
    window.localStorage.setItem(coachShownKey, "true");
  } catch {
    // Storage is blocked: the coach shows again next time.
  }
}

/** How long, in milliseconds, the notice that a session goes on with the day stays. */
const noticeMs = 3000;

/**
 * The study screen: the progress bar, and two cards of one size, the card answered just before,
 * split into front and back, above the current card, which shows its front alone, with
 * the two answer buttons under them. A click on the previous card opens it whole; a touch swipe
 * on it, Z or "마지막 응답 바꾸기" changes its answer. On a wide screen this session's answers are
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
              className={`${button} bg-primary text-on-primary`}
            >
              다시 시도
            </button>
            <Link href={back} className={quiet}>
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
  const [helpOpen, setHelpOpen] = useState(false);
  /** Whether the previous card is open whole. */
  const [detailOpen, setDetailOpen] = useState(false);
  const previousButton = useRef<HTMLButtonElement>(null);
  const helpButton = useRef<HTMLButtonElement>(null);
  const closeLink = useRef<HTMLAnchorElement>(null);
  const status = useSyncExternalStore(writes.subscribe, writes.getStatus, writes.getStatus);
  const router = useRouter();
  /** Where a leave held back by unsaved answers was going, while the screen asks; else null. */
  const [leaving, setLeaving] = useState<string | null>(null);
  /** The control that asked to leave, which takes the focus back if the user stays. */
  const leaveFrom = useRef<HTMLElement | null>(null);
  /** The coach's step; null while it does not show. */
  const [coach, setCoach] = useState<CoachStep | null>(null);
  /** Whether a card has been on screen, after which the coach no longer starts on its own. */
  const studied = useRef(false);
  // On a device's first session the coach starts the first time a card is on screen, at the
  // page's start or after "학습하기", as on the phone. It starts after the screen has mounted, so
  // the live region that announces it is already there, empty.
  useEffect(() => {
    if (view.kind !== "studying" || studied.current) return;
    studied.current = true;
    if (coachShown()) return;
    const timer = window.setTimeout(() => {
      setCoach("know");
    }, 0);
    return () => {
      window.clearTimeout(timer);
      studied.current = false;
    };
  }, [view.kind]);
  // The browser keeps that the coach has shown once it shows.
  useEffect(() => {
    if (coach) markCoachShown();
  }, [coach]);
  /**
   * That the session goes on with the day, said for a moment as it opens: set after the status
   * region has mounted empty, so a screen reader announces it, and cleared after [noticeMs].
   */
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    const { resumed, cards, minutes } = session.size;
    if (!resumed || cards === 0) return;
    const shown = window.setTimeout(() => {
      setNotice(`이어서 해요 · 남은 ${String(cards)}장 · 약 ${String(minutes)}분`);
    }, 0);
    const gone = window.setTimeout(() => {
      setNotice(null);
    }, noticeMs);
    return () => {
      window.clearTimeout(shown);
      window.clearTimeout(gone);
    };
  }, [session]);
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
  /**
   * A link out of the page while answers wait to be saved: instead of following it, sends them,
   * the failed one again first, then goes to [href], or asks before leaving if one fails again.
   */
  function exit(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (writes.getStatus().pending === 0) return;
    event.preventDefault();
    leaveFrom.current = event.currentTarget;
    void writes.flush().then((saved) => {
      if (saved) router.push(href);
      else setLeaving(href);
    });
  }
  function stay() {
    setLeaving(null);
    leaveFrom.current?.focus();
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

  // The handler reads the latest render's functions, so it is registered once.
  const keys = useRef<(event: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    keys.current = (event) => {
      if (isForeign(event)) return;
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
    };
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      keys.current(event);
    };
    window.addEventListener("keydown", listener);
    return () => {
      window.removeEventListener("keydown", listener);
    };
  }, []);

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

  // Unloading the page drops the writes still waiting, so the browser asks first; the page's own
  // links out go through [exit].
  const unsaved = status.pending > 0;
  useEffect(() => {
    if (!unsaved) return;
    const listener = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", listener);
    return () => {
      window.removeEventListener("beforeunload", listener);
    };
  }, [unsaved]);

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
        <CoachDemo answer={demo}>{currentCard}</CoachDemo>
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
      <header className="relative flex items-center gap-4">
        <Link
          ref={closeLink}
          href={back}
          onClick={(event) => {
            exit(event, back);
          }}
          aria-label="그만하기"
          aria-keyshortcuts="Escape"
          title="그만하기 (Esc)"
          className="pressable flex size-tap-target shrink-0 items-center justify-center rounded-full text-ink-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          <X aria-hidden className="size-5" strokeWidth={2.2} />
        </Link>
        <div className="flex flex-1 items-center gap-3">
          {view.kind !== "empty" && (
            <>
              <div
                role="progressbar"
                aria-label="진행"
                aria-valuemin={0}
                aria-valuemax={view.total}
                aria-valuenow={view.done}
                aria-valuetext={`${String(view.total)}장 중 ${String(view.done)}장 끝냄`}
                className="h-progress flex-1 overflow-hidden rounded-full bg-edge"
              >
                <div
                  className="h-full rounded-full bg-accent motion-safe:transition-[width]"
                  style={{
                    width: `${String(view.total === 0 ? 0 : (100 * view.done) / view.total)}%`,
                  }}
                />
              </div>
              <span aria-hidden className="text-secondary font-bold text-ink tabular-nums">
                {view.done}/{view.total}
              </span>
              {/* Cards past the day's plan are counted apart, so the day's bar never shrinks. */}
              {view.extra > 0 && (
                <Chip tone="brand">
                  <span aria-hidden className="whitespace-nowrap">
                    추가 {view.extra}장
                  </span>
                  <span className="sr-only">오늘 계획 밖으로 {view.extra}장 더 학습함</span>
                </Chip>
              )}
            </>
          )}
        </div>
        <button
          ref={helpButton}
          type="button"
          onClick={() => {
            setHelpOpen(true);
          }}
          aria-keyshortcuts="?"
          className={`${quiet} hidden lg:flex`}
        >
          단축키 <Hint>?</Hint>
        </button>
        <div
          role="status"
          className="pointer-events-none absolute inset-x-0 top-full z-10 mt-2 flex justify-center"
        >
          {notice && (
            <p className="rounded-full bg-hero px-4 py-2 text-secondary text-on-hero shadow-card motion-safe:animate-resume-notice">
              {notice}
            </p>
          )}
        </div>
        {/* Mounted empty, so the coach's steps are announced as they show. */}
        <p aria-live="polite" className="sr-only">
          {coach ? coachAnnouncement(coach, touchFirst()) : ""}
        </p>
      </header>

      {status.failure !== null && (
        <div role="alert" className="flex flex-col gap-3 rounded-row bg-surface p-4">
          <p className="text-dont-know-text">{status.failure}</p>
          <button
            type="button"
            onClick={() => {
              writes.retry();
            }}
            className={`${button} self-start bg-primary text-on-primary`}
          >
            다시 시도
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-center gap-7">
        <section
          aria-label="카드"
          className="flex min-w-0 flex-[999_1_520px] flex-col items-center gap-3 pt-6"
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
                className={`${button} mt-1 min-h-cta bg-primary text-on-primary`}
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
              <div className="grid w-full max-w-study auto-rows-fr gap-7">
                <div
                  className={`grid overflow-hidden ${cardHeight} motion-safe:transition-opacity ${demo ? "opacity-45" : ""}`}
                >
                  {view.kind === "studying" && coach === "redecide" ? (
                    <CoachSample />
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
                <div className="w-full max-w-study">
                  {coach ? (
                    <CoachCaption
                      step={coach}
                      touch={touchFirst()}
                      onNext={() => {
                        setCoach(coachSteps[coachSteps.indexOf(coach) + 1] ?? null);
                      }}
                      onSkip={() => {
                        setCoach(null);
                      }}
                    />
                  ) : (
                    <AnswerButtons
                      onAnswer={answer}
                      onGuide={() => {
                        setCoach("know");
                      }}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </section>

        {view.previous.length > 0 && <AnswerList answers={view.previous} onToggle={toggle} />}
      </div>

      {view.previous.length > 0 && (
        <button
          type="button"
          onClick={toggleLast}
          aria-keyshortcuts="Z"
          className={`${quiet} self-center`}
        >
          마지막 응답 바꾸기 <Hint>Z</Hint>
        </button>
      )}

      {helpOpen && <ShortcutHelp onClose={closeHelp} />}
      {leaving !== null && (
        <LeaveConfirm
          count={status.pending}
          onStay={stay}
          onLeave={() => {
            router.push(leaving);
          }}
        />
      )}
      {detailOpen && shown && <CardDetail answer={shown} onClose={closeDetail} />}
    </main>
  );
}

/**
 * The card under study, [cardHeight] high: its front alone, or a whole card's front with its
 * blanks empty, and the front's sounds' controls under it (ADR 0112), in the largest of the
 * front's three sizes at which it fits, scrolling inside past the last ([CardScroll],
 * ADR 0123); its back shows once answered, above. A horizontal touch swipe ([useSwipe]) moves and
 * tilts it over the answer it would give, and released past the phone's distance, or flung,
 * gives [onAnswer] that answer; a vertical one scrolls the card's content where it is taller
 * than the card, and the page otherwise, and a mouse drags nothing.
 */
function CurrentCard({
  card,
  onAnswer,
}: {
  card: PreviousAnswer["card"];
  onAnswer: (answer: Answer) => void;
}) {
  const { offset, dragging, toward, handlers } = useSwipe({ onCommit: onAnswer });
  return (
    <section
      aria-label="현재 카드"
      {...handlers}
      className={`relative flex touch-pan-y ${cardHeight}`}
    >
      {toward && (
        <div
          aria-hidden
          className={`absolute inset-0 flex items-center rounded-card px-6 text-secondary font-bold ${answerTints[toward]}`}
        >
          {grades[toward].name}
        </div>
      )}
      <div
        style={{
          transform: `translateX(${String(offset)}px) rotate(${String(offset * tiltPerPixel)}rad)`,
        }}
        className={`relative flex flex-1 rounded-card bg-surface shadow-card ${dragging ? "" : "motion-safe:transition-transform motion-safe:duration-300"}`}
      >
        <div aria-label="앞면" role="group" className="flex min-h-0 flex-1 rounded-card">
          <CardScroll>
            {card.whole ? (
              <div className="w-full">{card.whole.empty}</div>
            ) : card.sides ? (
              <div className="w-full">{card.sides.front}</div>
            ) : (
              <CardSide blocks={card.front} />
            )}
            {card.sounds && <SoundControls sounds={card.sounds.front} />}
          </CardScroll>
        </div>
      </div>
    </section>
  );
}

/** "모른다" and "안다" under the current card, each with its keys, and the coach's replay between. */
function AnswerButtons({
  onAnswer,
  onGuide,
}: {
  onAnswer: (answer: Answer) => void;
  onGuide: () => void;
}) {
  const answerButton = `${button} min-h-cta flex-1 text-body-strong`;
  return (
    <div className="flex gap-3">
      <button
        type="button"
        onClick={() => {
          onAnswer("dontKnow");
        }}
        aria-keyshortcuts="ArrowLeft"
        className={`${answerButton} bg-tint-red text-on-dont-know-tint`}
      >
        모른다 <Hint>←</Hint>
      </button>
      <button
        type="button"
        onClick={onGuide}
        className="pressable min-h-tap-target shrink-0 rounded-button px-2 text-caption text-ink-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        안내 다시 보기
      </button>
      <button
        type="button"
        onClick={() => {
          onAnswer("know");
        }}
        aria-keyshortcuts="ArrowRight"
        className={`${answerButton} bg-tint-green text-on-know-tint`}
      >
        안다 <Hint>→</Hint>
      </button>
    </div>
  );
}
