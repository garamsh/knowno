"use client";

import { X } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
} from "react";

import { keepFocusInside } from "./focus-trap";
import { useBackEntry } from "./use-back-entry";

/**
 * A native modal dialog open while mounted: focus moves in and returns to what opened it, Tab
 * stays inside, and Escape and the browser's back call [close], as the phone's back pops its top
 * route. It follows the part of the page the browser shows, `--visible-top` and
 * `--visible-height`, so an on-screen keyboard, which shrinks that part, does not cover its foot,
 * as the phone's screen and sheet sit above the keyboard.
 */
export function useModalDialog(close: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (trigger instanceof HTMLElement) trigger.focus();
    };
  }, []);
  useLayoutEffect(() => {
    const dialog = ref.current;
    const view = window.visualViewport;
    if (!dialog || !view) return;
    const follow = () => {
      dialog.style.setProperty("--visible-top", `${String(view.offsetTop)}px`);
      dialog.style.setProperty("--visible-height", `${String(view.height)}px`);
    };
    follow();
    view.addEventListener("resize", follow);
    view.addEventListener("scroll", follow);
    return () => {
      view.removeEventListener("resize", follow);
      view.removeEventListener("scroll", follow);
    };
  }, []);
  useBackEntry(close);
  return {
    ref,
    "aria-modal": true,
    onCancel: (event: SyntheticEvent) => {
      event.preventDefault();
      event.stopPropagation();
      close();
    },
    onKeyDown: (event: KeyboardEvent<HTMLDialogElement>) => {
      event.stopPropagation();
      keepFocusInside(event);
    },
  } as const;
}

/**
 * The one modal sheet, as the phone's `AppSheet`: at the foot below 1024 px and centred from it,
 * its [title] beside "닫기", over its scrolling [description], which the dialog is described by,
 * and [children]; a click on the scrim closes it.
 */
export function Sheet({
  title,
  description,
  children,
  close,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  close: () => void;
}) {
  const dialog = useModalDialog(close);
  const heading = useId();
  const described = useId();
  return (
    <dialog
      {...dialog}
      aria-labelledby={heading}
      aria-describedby={description === undefined ? undefined : described}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      className="fixed inset-x-0 top-[calc(var(--visible-top,0px)+var(--visible-height,100dvh))] bottom-auto m-0 max-h-[var(--visible-height,100dvh)] w-full max-w-none -translate-y-full overflow-hidden rounded-t-sheet bg-ground break-keep p-0 text-ink backdrop:bg-scrim lg:inset-0 lg:m-auto lg:max-h-[90dvh] lg:max-w-list lg:translate-y-0 lg:rounded-sheet"
    >
      <div className="flex max-h-[calc(var(--visible-height,100dvh)*0.9)] min-h-0 flex-col pb-[env(safe-area-inset-bottom)]">
        <header className="flex shrink-0 items-center justify-between gap-3 px-gutter py-3">
          <h2 id={heading} className="text-title break-keep">
            {title}
          </h2>
          <button
            type="button"
            aria-label="닫기"
            onClick={close}
            className="pressable flex size-tap-target shrink-0 items-center justify-center rounded-button"
          >
            <X aria-hidden className="size-5" />
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-gutter pb-4">
          {description !== undefined && (
            <p id={described} className="text-secondary break-keep text-muted">
              {description}
            </p>
          )}
          {children}
        </div>
      </div>
    </dialog>
  );
}
