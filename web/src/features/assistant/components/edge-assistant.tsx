"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type PointerEvent, useEffect, useRef, useState } from "react";

import { Mascot } from "@/design/brand";

import { useEdgeSide, useHintGone } from "../edge-preferences";
import { useReadyCards } from "./ready-bubble";

/** How far the character slides into its edge while the page scrolls: half its 72 px. */
const tuck = 36;

/** How long after a scroll ends the character comes back out of the edge. */
export const edgeReturnMs = 400;

/** How far a pointer moves before a press is a drag and not a tap. */
const dragStart = 8;

/** Whether a modal dialog, which the editor and photo import are, is open over the page. */
function useModalOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const look = () => {
      setOpen(document.querySelector("dialog[open]") !== null);
    };
    look();
    const observer = new MutationObserver(look);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    return () => {
      observer.disconnect();
    };
  }, []);
  return open;
}

/**
 * The height of the room under the page's last row: what [element] draws, the character and the
 * hint or ready bubble above it, and a gap of 24 px, so that nothing of it covers the last row.
 */
function useReserve(element: HTMLElement | null): number {
  const [height, setHeight] = useState(96);
  useEffect(() => {
    if (!element || typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(() => {
      setHeight(element.offsetHeight + 24);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [element]);
  return height;
}

/** Whether the page is being scrolled, until [edgeReturnMs] after it stops. */
function useScrolling(): boolean {
  const [scrolling, setScrolling] = useState(false);
  useEffect(() => {
    let timer: number | undefined;
    const scrolled = () => {
      setScrolling(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        setScrolling(false);
      }, edgeReturnMs);
    };
    window.addEventListener("scroll", scrolled, { passive: true });
    return () => {
      window.removeEventListener("scroll", scrolled);
      window.clearTimeout(timer);
    };
  }, []);
  return scrolling;
}

/**
 * 말랑이 as a character at the foot of the page's edge (#711, #722), drawn by the pages the owner
 * chose: the 노트 page, a note and 기록. It is a button named "말랑이와 대화하기" that opens the chat,
 * from [noteId]'s note where it is drawn in one, and at least 44 px. It breathes and blinks, as
 * the phone's does, and holds still under reduced motion; it tucks half into its edge while the
 * page scrolls and comes back when scrolling stops; a drag, or an arrow key, moves it to the other
 * edge, where this browser keeps it. A short bubble says how many cards are ready; with [hint],
 * once, until it is tapped or closed, a bubble says that tapping it opens the chat. It leaves the
 * page while a dialog is open, and keeps the room under the page's last row.
 */
export function EdgeAssistant({ noteId, hint = false }: { noteId?: string; hint?: boolean }) {
  const router = useRouter();
  const [side, setSide] = useEdgeSide();
  const [hintGone, endHint] = useHintGone();
  const ready = useReadyCards();
  const modal = useModalOpen();
  const scrolling = useScrolling();
  const [drag, setDrag] = useState<number | null>(null);
  const press = useRef<{ from: number; moved: boolean } | null>(null);
  const dropped = useRef(false);
  const [group, setGroup] = useState<HTMLDivElement | null>(null);
  const reserve = useReserve(group);
  if (modal) return null;

  const right = side === "right";
  const showHint = hint && !hintGone && ready === 0;
  const name =
    ready > 0 ? `말랑이와 대화하기, ${String(ready)}장 만들어 뒀어요` : "말랑이와 대화하기";

  const open = () => {
    endHint();
    router.push(noteId ? `/assistant?note=${noteId}` : "/assistant");
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const started = press.current;
    if (!started) return;
    const along = event.clientX - started.from;
    if (!started.moved && Math.abs(along) < dragStart) return;
    started.moved = true;
    setDrag(along);
  };
  const release = (event: PointerEvent<HTMLButtonElement>) => {
    const started = press.current;
    press.current = null;
    if (!started?.moved) return;
    // A drag ends at the edge nearer where it was let go; the click that follows is not a tap.
    dropped.current = true;
    setSide(event.clientX < window.innerWidth / 2 ? "left" : "right");
    setDrag(null);
  };

  const tucked = scrolling && drag === null;
  return (
    <>
      {/* The room the page keeps under its last row, so the character never covers it. */}
      <div aria-hidden className="shrink-0" style={{ height: reserve }} />
      <div
        ref={setGroup}
        className={`fixed bottom-[calc(max(1rem,env(safe-area-inset-bottom))+var(--spacing-tab-bar)+0.75rem)] z-10 flex items-end gap-2 lg:bottom-6 ${
          right
            ? "right-[max(0.75rem,env(safe-area-inset-right))] flex-col items-end sm:flex-row"
            : "left-[max(0.75rem,env(safe-area-inset-left))] flex-col items-start sm:flex-row-reverse lg:left-[calc(15rem+0.75rem)]"
        }`}
      >
        {showHint && (
          <div
            className={`flex max-w-72 items-center gap-1 rounded-row bg-surface pl-4 text-label text-ink shadow-raised motion-safe:transition-opacity ${scrolling ? "pointer-events-none opacity-0" : ""}`}
          >
            <p className="py-2 break-keep">말랑이를 누르면 언제든 대화할 수 있어요</p>
            <button
              type="button"
              aria-label="안내 닫기"
              onClick={endHint}
              className="pressable flex size-tap-target shrink-0 items-center justify-center rounded-button text-muted"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
        )}
        <button
          type="button"
          aria-label={name}
          onClick={() => {
            if (dropped.current) dropped.current = false;
            else open();
          }}
          onPointerDown={(event) => {
            press.current = { from: event.clientX, moved: false };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={move}
          onPointerUp={release}
          onPointerCancel={() => {
            press.current = null;
            setDrag(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") setSide("left");
            if (event.key === "ArrowRight") setSide("right");
          }}
          className={`flex touch-pan-y items-end gap-2 rounded-row focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${right ? "flex-col items-end sm:flex-row" : "flex-col items-start sm:flex-row-reverse"}`}
        >
          {ready > 0 && (
            <span
              aria-hidden
              className={`rounded-row bg-surface px-4 py-2 text-label text-ink shadow-raised motion-safe:transition-opacity ${scrolling ? "opacity-0" : ""}`}
            >
              {ready}장 만들어 뒀어요
            </span>
          )}
          <span
            className={`block ${drag === null ? "motion-safe:transition-transform" : ""}`}
            style={{
              transform: `translateX(${String(drag ?? (tucked ? (right ? tuck : -tuck) : 0))}px)`,
            }}
          >
            <Mascot expression="thinking" breathes className="block size-18" />
          </span>
        </button>
      </div>
    </>
  );
}
