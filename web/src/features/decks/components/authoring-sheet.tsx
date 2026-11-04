"use client";

import { ChevronLeft, X } from "lucide-react";
import { type ReactNode, useId } from "react";
import { useModalDialog } from "@/design/sheet";

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
  const dialog = useModalDialog(close);
  const titleId = useId();
  const Icon = back ? ChevronLeft : X;
  return (
    <dialog
      {...dialog}
      aria-labelledby={titleId}
      className="fixed inset-x-0 top-[var(--visible-top,0px)] m-0 h-[var(--visible-height,100dvh)] w-full max-h-none max-w-none overflow-hidden bg-ground break-keep p-0 text-ink backdrop:bg-scrim lg:inset-0 lg:m-auto lg:h-fit lg:max-h-[90dvh] lg:max-w-list lg:rounded-sheet"
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
