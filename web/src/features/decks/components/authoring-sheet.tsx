"use client";

import { ChevronLeft, X } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
} from "react";
import { keepFocusInside } from "@/design/focus-trap";
import { useBackEntry } from "../hooks/use-back-entry";

/**
 * A native modal dialog open while mounted: focus moves in and returns to what opened it, Tab
 * stays inside, and Escape and the browser's back call [close], as the phone's back pops its top
 * route. It follows the part of the page the browser shows, `--visible-top` and
 * `--visible-height`, so an on-screen keyboard, which shrinks that part, does not cover its foot,
 * as the phone's screen and sheet sit above the keyboard.
 */
function useAuthoringDialog(close: () => void) {
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

/** The authoring flow's modal sheet, at the foot below 1024 px and centred from it. */
export function AuthoringSheet({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const dialog = useAuthoringDialog(close);
  const heading = useId();
  return (
    <dialog
      {...dialog}
      aria-labelledby={heading}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      className="fixed inset-x-0 top-[calc(var(--visible-top,0px)+var(--visible-height,100dvh))] bottom-auto m-0 max-h-[var(--visible-height,100dvh)] w-full max-w-none -translate-y-full overflow-hidden rounded-t-sheet bg-ground break-keep p-0 text-ink backdrop:bg-hero/40 lg:inset-0 lg:m-auto lg:max-h-[90dvh] lg:max-w-list lg:translate-y-0 lg:rounded-sheet"
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
        <div className="min-h-0 overflow-y-auto overscroll-contain px-gutter pb-4">{children}</div>
      </div>
    </dialog>
  );
}

/**
 * An authoring flow's screen, as the phone pushes one (ADR 0158): below 1024 px the whole page,
 * its title bar led by "닫기", or "뒤로" with [back], over the scrolling [children] and the
 * [actions] fixed at its foot; from 1024 px the same in a dialog. The [title] is in the bar, or
 * heads the scrolling content where the phone's screen draws it there ([heading] "body"), or names
 * the screen for a screen reader alone where the phone's draws none ([heading] "none"). [menu],
 * the phone's ⋯, ends the bar.
 */
export function AuthoringScreen({
  title,
  children,
  actions,
  back = false,
  heading = "bar",
  menu,
  close,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  back?: boolean;
  heading?: "bar" | "body" | "none";
  menu?: ReactNode;
  close: () => void;
}) {
  const dialog = useAuthoringDialog(close);
  const titleId = useId();
  const Icon = back ? ChevronLeft : X;
  return (
    <dialog
      {...dialog}
      aria-labelledby={titleId}
      className="fixed inset-x-0 top-[var(--visible-top,0px)] m-0 h-[var(--visible-height,100dvh)] w-full max-h-none max-w-none overflow-hidden bg-ground break-keep p-0 text-ink backdrop:bg-hero/40 lg:inset-0 lg:m-auto lg:h-fit lg:max-h-[90dvh] lg:max-w-list lg:rounded-sheet"
    >
      <div className="flex h-full min-h-0 flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] lg:h-auto lg:max-h-[90dvh]">
        <header className="flex shrink-0 items-center gap-2 px-2 py-2 lg:px-3">
          <button
            type="button"
            aria-label={back ? "뒤로" : "닫기"}
            onClick={close}
            className="pressable flex size-tap-target shrink-0 items-center justify-center rounded-button"
          >
            <Icon aria-hidden className="size-6" />
          </button>
          {heading === "bar" && (
            <h2 id={titleId} className="min-w-0 text-title break-keep">
              {title}
            </h2>
          )}
          {heading === "none" && (
            <h2 id={titleId} className="sr-only">
              {title}
            </h2>
          )}
          {menu && <div className="ml-auto">{menu}</div>}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-gutter pt-2 pb-4">
          {heading === "body" && (
            <h2 id={titleId} className="text-title break-keep">
              {title}
            </h2>
          )}
          {children}
        </div>
        {actions && <div className="shrink-0 px-gutter pt-2 pb-4">{actions}</div>}
      </div>
    </dialog>
  );
}
