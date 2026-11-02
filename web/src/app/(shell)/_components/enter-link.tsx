"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

/**
 * The page's one study button, [label], which opens [href], showing its Enter key from 1024 px
 * wide: in the primary fill across the page's column, or with [onHero] in the hero button's
 * colours, sized to its label, on its edge. Enter opens it from anywhere on the page but a
 * control or a field, which keep their own Enter.
 */
export function EnterLink({
  href,
  label,
  onHero = false,
}: {
  href: string;
  label: string;
  onHero?: boolean;
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
      className={`pressable flex min-h-cta items-center justify-center gap-2 rounded-button px-6 text-button break-keep focus-visible:outline-2 focus-visible:outline-offset-2 ${
        onHero
          ? "w-full max-w-56 bg-hero-button text-on-hero-button [--edge-colour:var(--color-primary-edge)] [--edge:var(--spacing-edge-button)] focus-visible:outline-on-hero"
          : "w-full bg-primary text-on-primary focus-visible:outline-ink"
      }`}
    >
      {label}
      <kbd
        aria-hidden
        className="hidden rounded-md border border-current px-1.5 text-micro font-bold lg:inline"
      >
        Enter
      </kbd>
    </Link>
  );
}
