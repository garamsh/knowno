"use client";

import { type ReactNode, useLayoutEffect, useRef } from "react";

/**
 * [children] on one line, shrunk to the column only where they are wider than it, never cut, as
 * the phone's `FittedBox` with `BoxFit.scaleDown` draws a figure or label a narrow column holds
 * (`design/principles.md` §Nothing clipped). The box fills the column and takes [className], the line's text
 * style and alignment.
 */
export function FittedLine({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const box = useRef<HTMLSpanElement>(null);
  const line = useRef<HTMLSpanElement>(null);

  // Measures the line at its own size, then zooms it, its height with it, to the column. The zoom
  // is set on the line directly, so the resize it causes fits to the same zoom and renders nothing.
  useLayoutEffect(() => {
    const column = box.current;
    const text = line.current;
    if (!column || !text) return;
    const fit = () => {
      text.style.zoom = "";
      const natural = text.getBoundingClientRect().width;
      const room = column.clientWidth;
      if (natural > room && room > 0) text.style.zoom = String(room / natural);
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    observer.observe(column);
    observer.observe(text);
    return () => {
      observer.disconnect();
    };
  }, [children]);

  return (
    <span ref={box} className={`block w-full min-w-0 ${className}`}>
      <span ref={line} className="inline-block whitespace-nowrap">
        {children}
      </span>
    </span>
  );
}
