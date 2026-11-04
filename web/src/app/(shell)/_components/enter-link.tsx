"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import { buttonClass } from "@/design/button";

/**
 * The page's one study button, [label], which opens [href], showing its Enter key from 1024 px
 * wide: across the page's column in the primary fill, or in [variant]'s, on its edge. Enter opens
 * it from anywhere on the page but a control or a field, which keep their own Enter.
 */
export function EnterLink({
  href,
  label,
  variant = "primary",
}: {
  href: string;
  label: string;
  variant?: "primary" | "secondary";
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
      className={`${buttonClass(variant, "cta")} w-full`}
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
