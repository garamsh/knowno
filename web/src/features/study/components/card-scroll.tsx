"use client";

import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

/** The sizes a front steps down through, largest first, the body size last (#635). */
const steps = ["text-front", "text-deck-name", "text-back", "text-card-body"] as const;

/**
 * The longest a front starts at each step but the last, by `faceLength`, as the phone's
 * `StudyStyle.frontSteps` (#635).
 */
const startLengths = [12, 40, 100];

/** The step a front of [length] characters starts at. */
function startOf(length: number): number {
  const start = startLengths.findIndex((longest) => length <= longest);
  return start < 0 ? steps.length - 1 : start;
}

/**
 * A card front's content, [length] characters long (`faceLength`), in the largest of the front's
 * sizes from the one its length starts at (#635) at which it fits the face whole, its lines
 * broken only between words: centred above the body size, start-aligned at it, and past it
 * scrolling inside the face from the top, its bottom edge fading into the surface while more is
 * below (ADR 0123), as the phone's `CardScroll`.
 */
export function CardScroll({ length, children }: { length: number; children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const start = startOf(length);
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
  }, [index, last, children, frameSize]);

  // A face of a new size fits its content again from the step its length starts at. The frame is watched,
  // not the scrolling face, whose width changes as its own scrollbar comes and goes.
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

  const body = index >= last;
  return (
    <div ref={frame} className="relative flex min-h-0 flex-1">
      <div
        ref={box}
        data-card-step={step}
        onScroll={(event) => {
          const face = event.currentTarget;
          setMore(face.scrollHeight - face.scrollTop - face.clientHeight > 1);
        }}
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
      {more && (
        <div
          aria-hidden
          data-card-fade
          className="pointer-events-none absolute inset-x-0 bottom-0 h-8 rounded-b-card bg-linear-to-b from-transparent to-surface"
        />
      )}
    </div>
  );
}
