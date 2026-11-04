"use client";

import { useLayoutEffect, useRef } from "react";
import { ChevronRight } from "lucide-react";

/**
 * The phone's bar for an import whose screen is closed, heading every page in the flow above it,
 * so it covers nothing: [label] in words, announced as it changes, over a bar of [progress] while
 * photos are read. A tap [open]s the import. It sets `--photo-import-bar` to its height while
 * shown, which what sticks to the top of the page sits below.
 */
export function ImportBar({
  label,
  progress,
  open,
}: {
  label: string;
  progress: number | null;
  open: () => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = bar.current;
    if (!element) return;
    const root = document.documentElement;
    const measure = () => {
      root.style.setProperty("--photo-import-bar", `${String(element.offsetHeight)}px`);
    };
    measure();
    // A larger text size or a narrower window changes its height.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      root.style.removeProperty("--photo-import-bar");
    };
  }, []);
  return (
    <div
      ref={bar}
      className="sticky top-0 z-30 bg-ground px-gutter pt-[env(safe-area-inset-top)] lg:px-8"
    >
      <button
        type="button"
        onClick={open}
        className="pressable mx-auto my-2 flex min-h-tap-target w-full max-w-content flex-col justify-center gap-1 rounded-field bg-surface px-4 py-2 text-left focus-visible:outline-2 focus-visible:outline-ink"
      >
        <span className="flex w-full items-center gap-2">
          <span aria-live="polite" className="min-w-0 flex-1 text-body-strong break-keep text-ink">
            {label}
          </span>
          <ChevronRight aria-hidden className="size-small-icon shrink-0 text-ink-2" />
        </span>
        {progress !== null && (
          <span aria-hidden className="block h-1 w-full overflow-hidden rounded-full bg-edge">
            <span
              className="block h-full rounded-full bg-accent"
              style={{ width: `${String(100 * progress)}%` }}
            />
          </span>
        )}
      </button>
    </div>
  );
}
