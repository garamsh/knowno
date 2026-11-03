"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { answerSavedAt, subscribeAnswerSaved } from "../answer-saved";

/**
 * Reads the page it is on again, once, when a study answer the server stored after [readAt], the
 * server's time when the page read its data, has landed: on showing, for one that landed while
 * the page was away, and while shown, for one still in flight (ADR 0169). It draws nothing.
 */
export function StudyFreshness({ readAt }: { readAt: number }) {
  const router = useRouter();
  /** The latest saved answer this page has already been read again for. */
  const readAgainFor = useRef<number | null>(null);
  useEffect(() => {
    const readAgainIfStale = () => {
      const saved = answerSavedAt();
      if (saved === null || saved <= readAt) return;
      if (readAgainFor.current !== null && saved <= readAgainFor.current) return;
      readAgainFor.current = saved;
      router.refresh();
    };
    readAgainIfStale();
    return subscribeAnswerSaved(readAgainIfStale);
  }, [readAt, router]);
  return null;
}
