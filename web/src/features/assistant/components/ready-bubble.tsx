"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { useReducedMotion } from "@/design/brand";

import { checkedCount, conversationKey, parseConversation, readyProposal } from "../conversation";

function subscribe(changed: () => void) {
  window.addEventListener("storage", changed);
  return () => {
    window.removeEventListener("storage", changed);
  };
}

function storedText(): string | null {
  try {
    return window.localStorage.getItem(conversationKey);
  } catch {
    return null;
  }
}

/**
 * How many cards 말랑이 has ready to add: those checked in the proposal not yet added, read from
 * the chat this browser keeps; 0 for none, and on the server, which keeps no chat.
 */
export function useReadyCards(): number {
  const stored = useSyncExternalStore(subscribe, storedText, () => null);
  const ready = stored === null ? null : readyProposal(parseConversation(stored));
  return ready && ready.proposal.kind === "cards" ? checkedCount(ready) : 0;
}

/**
 * The speech bubble over 홈's mascot while 말랑이 has new cards ready (#722): "카드 n장 만들어
 * 뒀어요"; nothing otherwise.
 */
export function ReadyBubble({ className }: { className: string }) {
  const count = useReadyCards();
  if (count === 0) return null;
  return (
    <span className={className}>
      {/* Read after the link's own name, "말랑이와 대화하기". */}
      <span className="sr-only">, </span>
      카드 {count}장 만들어 뒀어요
    </span>
  );
}

/** What 홈's state makes 말랑이 offer: cards left, the day's cards done, or neither. */
export type ChatLine = "cards" | "done" | "other";

const lines: Record<ChatLine, string> = {
  cards: "오늘 배운 거, 같이 카드로 만들까요?",
  done: "수고했어요. 얘기 좀 할래요?",
  other: "말랑이와 대화해요",
};

/** The local day the offer last showed on, kept in this browser alone (#923). */
const shownKey = "knowno.assistant.offer";

/** How long after 홈 appears the offer shows, how long it stays, and how long it takes to fade. */
export const offerDelayMs = 1500;
export const offerStayMs = 6000;
export const offerFadeMs = 300;

/** [now]'s calendar day in the browser's zone, as `YYYY-MM-DD`. */
function localDay(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function shownDay(): string | null {
  try {
    return window.localStorage.getItem(shownKey);
  } catch {
    return null;
  }
}

function keepShownDay(day: string) {
  try {
    window.localStorage.setItem(shownKey, day);
  } catch {
    // Storage refused: the offer may show again on the next 홈 open.
  }
}

/**
 * The offer over 홈's mascot (#923): [line] by 홈's state, shown at most once a local day, on the
 * first 홈 open of it, a moment after 홈 appears, and gone after about 6 s, with no motion under
 * reduced motion. It waits while the ready bubble shows, and the day is spent only once it has
 * shown. It is decorative: the mascot's link already says it opens the chat.
 */
export function ChatBubble({ className, line }: { className: string; line: ChatLine }) {
  const ready = useReadyCards();
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<"idle" | "shown" | "fading">("idle");
  useEffect(() => {
    if (ready > 0) return;
    const timer = window.setTimeout(() => {
      const day = localDay(new Date());
      if (shownDay() === day) return;
      keepShownDay(day);
      setPhase("shown");
    }, offerDelayMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [ready]);
  useEffect(() => {
    if (phase === "idle") return;
    const timer = window.setTimeout(
      () => {
        setPhase(phase === "shown" && !reduced ? "fading" : "idle");
      },
      phase === "shown" ? offerStayMs : offerFadeMs,
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, [phase, reduced]);
  if (phase === "idle" || ready > 0) return null;
  return (
    <span
      aria-hidden
      className={`${className} ${reduced ? "" : "transition-opacity duration-300"} ${phase === "fading" ? "opacity-0" : ""}`}
    >
      {lines[line]}
    </span>
  );
}
