"use client";

import { useEffect, useRef, useState } from "react";

import { type CoachStep, coachShownKey } from "../components/study-coach";
import type { SessionView } from "../session";

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

/**
 * The first-use coach's step, null while it does not show, and its setter. On a device's first
 * session the coach starts the first time a card is on screen, as [kind] says, at the page's start
 * or after "학습하기", as on the phone; the browser keeps that it has shown once it shows.
 */
export function useCoach(kind: SessionView["kind"]) {
  const [coach, setCoach] = useState<CoachStep | null>(null);
  /** Whether a card has been on screen, after which the coach no longer starts on its own. */
  const studied = useRef(false);
  // It starts after the screen has mounted, so the live region that announces it is already
  // there, empty.
  useEffect(() => {
    if (kind !== "studying" || studied.current) return;
    studied.current = true;
    if (coachShown()) return;
    const timer = window.setTimeout(() => {
      setCoach("know");
    }, 0);
    return () => {
      window.clearTimeout(timer);
      studied.current = false;
    };
  }, [kind]);
  useEffect(() => {
    if (coach) markCoachShown();
  }, [coach]);
  return [coach, setCoach] as const;
}
