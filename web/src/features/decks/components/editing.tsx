"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { CellDraft } from "../authoring";

/** Finds what takes the focus once a change is drawn; none leaves the focus where it is. */
export type Find = () => HTMLElement | null | undefined;

/** What the card editor's fields share: a delete offered back by the snack, and the next focus. */
export type Editing = {
  /**
   * Puts [after] in [before]'s place at once, focusing what [next] finds, and offers 되돌리기
   * under [said], which puts [before] back and focuses what [back] finds.
   */
  remove: (removal: {
    said: string;
    before: CellDraft;
    after: CellDraft;
    next: Find;
    back: Find;
  }) => void;
  /** Focuses what [find] finds once the change under way is drawn. */
  focusSoon: (find: Find) => void;
};

export const EditingContext = createContext<Editing | null>(null);

export function useEditing(): Editing {
  const editing = useContext(EditingContext);
  if (!editing) throw new Error("a 칸's fields are drawn inside CellFields");
  return editing;
}

/** The 칸 [id]'s group. */
export const cellSection = (id: string | undefined) =>
  id === undefined ? null : document.querySelector<HTMLElement>(`[data-cell="${id}"]`);

/** [container]'s first text field, else its first control but a menu's ⋯. */
export function firstField(container: Element | null | undefined) {
  return (
    container?.querySelector<HTMLElement>("textarea, input:not([type=file])") ??
    container?.querySelector<HTMLElement>("button:not([aria-haspopup]), input[type=file]")
  );
}

/** Whether the focus left the page's controls, or is still inside [container]. */
export function focusLost(container: Element | null) {
  const now = document.activeElement;
  return !now || now === document.body || !!container?.contains(now);
}

/** The scrolling part around [element], where it has one. */
function scrollerOf(element: Element): Element | null {
  for (let at = element.parentElement; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if (overflowY === "auto" || overflowY === "scroll") return at;
  }
  return null;
}

/**
 * The editor's snack bar, as the phone's: [said] in ink with "되돌리기", at the foot of the part
 * that scrolls, so above the editor's actions and inside its dialog. It goes after four seconds,
 * held while the focus or the pointer is on it.
 */
export function UndoSnack({
  said,
  undo,
  dismiss,
}: {
  said: string;
  undo: () => void;
  dismiss: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [held, setHeld] = useState(false);
  const [place, setPlace] = useState<{ top: number; left: number; width: number } | null>(null);
  useEffect(() => {
    if (held) return;
    // The phone's snack bar stays four seconds.
    const timer = setTimeout(dismiss, 4000);
    return () => {
      clearTimeout(timer);
    };
  }, [held, dismiss]);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const scroller = scrollerOf(element);
    const follow = () => {
      const rect = scroller?.getBoundingClientRect();
      setPlace(
        rect
          ? { top: rect.bottom, left: rect.left, width: rect.width }
          : { top: window.innerHeight, left: 0, width: window.innerWidth },
      );
    };
    follow();
    window.addEventListener("resize", follow);
    window.visualViewport?.addEventListener("resize", follow);
    return () => {
      window.removeEventListener("resize", follow);
      window.visualViewport?.removeEventListener("resize", follow);
    };
  }, []);
  return (
    <div
      ref={root}
      style={place ?? undefined}
      className="pointer-events-none fixed z-20 flex -translate-y-full justify-center px-gutter pb-2"
    >
      <div
        onFocus={() => {
          setHeld(true);
        }}
        onBlur={() => {
          setHeld(false);
        }}
        onPointerEnter={() => {
          setHeld(true);
        }}
        onPointerLeave={() => {
          setHeld(false);
        }}
        className="pointer-events-auto flex w-full max-w-list items-center gap-2 rounded-button bg-ink py-1 pr-1 pl-4 text-on-ink shadow-raised"
      >
        <p role="status" className="min-w-0 flex-1 text-secondary">
          {said}
        </p>
        <button
          type="button"
          onClick={undo}
          className="pressable min-h-tap-target shrink-0 rounded-button px-3 text-body-strong text-on-ink focus-visible:outline-2 focus-visible:outline-on-ink"
        >
          되돌리기
        </button>
      </div>
    </div>
  );
}
