"use client";

import { type ReactNode, type UIEvent, useLayoutEffect, useRef, useState } from "react";

/** The sizes a front steps down through, largest first, the body size last (#635). */
const steps = ["text-front", "text-deck-name", "text-back", "text-card-body"] as const;

/**
 * The longest a front starts at each step but the last, by `faceLength`, as the phone's
 * `StudyStyle.frontSteps` (#635).
 */
const startLengths = [12, 40, 100];

/**
 * The step a front of [length] characters starts at, never above [largest]: a previous card's
 * front over its back starts no larger than `text-deck-name`, as the phone's
 * `StudyStyle.previousFrontStart` (#635).
 */
export function startOf(length: number, largest: (typeof steps)[number] = "text-front"): number {
  const start = startLengths.findIndex((longest) => length <= longest);
  return Math.max(start < 0 ? steps.length - 1 : start, steps.indexOf(largest));
}

/**
 * The step a card face's [content] takes from [start] down: the largest at which it fits the
 * scrolling face, `box`, whole, and past the last the face scrolls; and whether more is below. A
 * new size of the face's `frame` fits it again from [start].
 */
export function useCardStep<Face extends HTMLElement>(start: number, content: ReactNode) {
  const frame = useRef<Face>(null);
  const box = useRef<Face>(null);
  const [index, setIndex] = useState(start);
  const [more, setMore] = useState(false);
  // The frame's size the step was fitted to. A resize sets it as well as the step, so the fit runs
  // again where the step was already the largest and setting it alone would render nothing.
  const [frameSize, setFrameSize] = useState("");
  const last = steps.length - 1;
  const step = steps[Math.min(index, last)] ?? "text-card-body";

  // Steps down while the content is wider or taller than the face, then reads whether more is
  // below. Runs before paint, so a step that does not fit is never shown.
  useLayoutEffect(() => {
    const face = box.current;
    if (!face) return;
    const overflows = face.scrollHeight > face.clientHeight || face.scrollWidth > face.clientWidth;
    if (overflows && index < last) {
      setIndex(index + 1);
      return;
    }
    setMore(face.scrollHeight - face.scrollTop - face.clientHeight > 1);
  }, [index, last, content, frameSize]);

  // A face of a new size fits its content again from [start]. The frame is watched, not the
  // scrolling face, whose width changes as its own scrollbar comes and goes.
  useLayoutEffect(() => {
    const outer = frame.current;
    if (!outer || typeof ResizeObserver === "undefined") return;
    let width = outer.offsetWidth;
    let height = outer.offsetHeight;
    const observer = new ResizeObserver(() => {
      if (outer.offsetWidth === width && outer.offsetHeight === height) return;
      width = outer.offsetWidth;
      height = outer.offsetHeight;
      setFrameSize(`${String(width)}x${String(height)}`);
      setIndex(start);
    });
    observer.observe(outer);
    return () => {
      observer.disconnect();
    };
  }, [start]);

  return {
    frame,
    box,
    step,
    body: index >= last,
    more,
    onScroll: (event: UIEvent<Face>) => {
      const face = event.currentTarget;
      setMore(face.scrollHeight - face.scrollTop - face.clientHeight > 1);
    },
  };
}

/**
 * A card front's content, [length] characters long (`faceLength`), in the largest of the front's
 * sizes from the one its length starts at (#635) at which it fits the face whole, its lines
 * broken only between words: centred above the body size, start-aligned at it, and past it
 * scrolling inside the face from the top, its bottom edge fading into the surface while more is
 * below (ADR 0123), as the phone's `CardScroll`.
 */
export function CardScroll({ length, children }: { length: number; children: ReactNode }) {
  const { frame, box, step, body, more, onScroll } = useCardStep<HTMLDivElement>(
    startOf(length),
    children,
  );
  return (
    <div ref={frame} className="relative flex min-h-0 flex-1">
      <div
        ref={box}
        data-card-step={step}
        onScroll={onScroll}
        className="flex min-h-0 flex-1 overflow-y-auto p-6"
      >
        <div
          className={`m-auto flex w-full flex-col items-center gap-4 break-keep ${step} ${
            body ? "text-start wrap-break-word" : "text-center"
          }`}
        >
          {children}
        </div>
      </div>
      {more && <CardFade />}
    </div>
  );
}

/** A face's bottom edge fading into the surface while more is below (ADR 0123). */
export function CardFade() {
  return (
    <span
      aria-hidden
      data-card-fade
      className="pointer-events-none absolute inset-x-0 bottom-0 h-8 rounded-b-card bg-linear-to-b from-transparent to-surface"
    />
  );
}
