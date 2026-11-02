"use client";

import { Play } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";

/**
 * The page's one study button, [label], in the ink fill, which opens [href], showing its Enter
 * key from 1024 px wide: sized as a row inside a white card, or with [onGround] across the page's
 * two columns on its ground. Enter opens it from anywhere on the page but a control or a field,
 * which keep their own Enter.
 */
export function EnterLink({
  href,
  label,
  onGround = false,
}: {
  href: string;
  label: string;
  onGround?: boolean;
}) {
  const link = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.isComposing || event.altKey || event.ctrlKey) return;
      if (event.metaKey || event.shiftKey) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("a, button, input, select, textarea, [role]")
      ) {
        return;
      }
      event.preventDefault();
      link.current?.click();
    };
    window.addEventListener("keydown", listener);
    return () => {
      window.removeEventListener("keydown", listener);
    };
  }, []);
  return (
    <Link
      ref={link}
      href={href}
      aria-keyshortcuts="Enter"
      className={`pressable flex min-h-cta items-center justify-center gap-2 rounded-button bg-primary px-6 text-button text-on-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
        onGround ? "lg:col-span-2" : "flex-[1_1_100%] whitespace-nowrap sm:min-w-60 sm:flex-none"
      }`}
    >
      <Play aria-hidden className="size-small-icon" strokeWidth={2} />
      {label}
      <kbd
        aria-hidden
        className="hidden rounded-md border border-outline px-1.5 text-micro font-bold lg:inline"
      >
        Enter
      </kbd>
    </Link>
  );
}
