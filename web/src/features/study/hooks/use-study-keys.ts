"use client";

import { useEffect, useRef } from "react";

/** What a key press asks of the study screen. */
type StudyKey = "help" | "leave" | "know" | "dontKnow" | "toggleLast";

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
export function shortcut(
  event: KeyboardEvent,
  studying: boolean,
  answered: boolean,
): StudyKey | null {
  if (event.key === "?") return "help";
  if (event.key === "Escape") return "leave";
  if (event.key === "ArrowRight") return studying ? "know" : null;
  if (event.key === "ArrowLeft") return studying ? "dontKnow" : null;
  // A letter by its physical key, so it works whatever the keyboard's input language.
  if (event.code === "KeyZ") return answered ? "toggleLast" : null;
  return null;
}

/**
 * Hands the page's key presses, those [isForeign] leaves to the study screen, to [handle]. The
 * listener is registered once and reads the latest render's [handle].
 */
export function useStudyKeys(handle: (event: KeyboardEvent) => void) {
  const keys = useRef<(event: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    keys.current = handle;
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (isForeign(event)) return;
      keys.current(event);
    };
    window.addEventListener("keydown", listener);
    return () => {
      window.removeEventListener("keydown", listener);
    };
  }, []);
}
