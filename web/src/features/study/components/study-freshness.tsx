"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { answerSavedAt, subscribeAnswerSaved } from "../answer-saved";

/**
 * Reads the page it is on again, once, when a study answer saved after the page was read has
 * landed: on showing again, for one saved while the page was away, and while shown, for one still
 * in flight when the page came back (ADR 0169). It draws nothing.
 */
export function StudyFreshness() {
  const router = useRouter();
  /** When the page was last read, by the browser's clock; set on the first show. */
  const readAt = useRef<number | null>(null);
  // The App Router keeps a page it leaves hidden, its refs intact, and runs this again when it
  // shows the page again.
  useEffect(() => {
    readAt.current ??= Date.now();
    const readAgainIfStale = () => {
      const saved = answerSavedAt();
      if (saved === null || readAt.current === null || saved <= readAt.current) return;
      readAt.current = Date.now();
      router.refresh();
    };
    readAgainIfStale();
    return subscribeAnswerSaved(readAgainIfStale);
  }, [router]);
  return null;
}
