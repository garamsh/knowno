"use client";

import { Ellipsis } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

/** A 칸's ⋯: muted, on no surface of its own. */
const quiet =
  "pressable flex size-tap-target items-center justify-center rounded-button text-muted focus-visible:outline-2 focus-visible:outline-ink";

/**
 * A pull-down menu behind ⋯, named [label], as the deck's section menu: Escape closes it alone.
 * [trigger] draws the button where it is not a 칸's, and [face] what it shows in place of ⋯. A
 * pick hands the focus back to the button before it acts, so the act may move it on.
 */
export function RowMenu({
  label,
  items,
  trigger = quiet,
  face,
  disabled = false,
}: {
  label: string;
  items: { label: string; disabled?: boolean; danger?: boolean; pick: () => void }[];
  trigger?: string;
  face?: ReactNode;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>("[role=menuitem]:not(:disabled)")?.focus();
    function outside(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && !menu.current?.parentElement?.contains(target)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
    };
  }, [open]);
  return (
    <div className="relative shrink-0">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        disabled={disabled}
        onClick={() => {
          setOpen(!open);
        }}
        className={trigger}
      >
        {face ?? <Ellipsis aria-hidden className="size-5" />}
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label={label}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              // Stops the dialog's own Escape: it closes the menu alone.
              event.preventDefault();
              setOpen(false);
              button.current?.focus();
            }
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            const enabled = Array.from(
              menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not(:disabled)") ?? [],
            );
            const at = enabled.findIndex((item) => item === document.activeElement);
            const step = event.key === "ArrowDown" ? 1 : -1;
            enabled[(at + step + enabled.length) % enabled.length]?.focus();
          }}
          className="absolute top-full right-0 z-10 flex min-w-32 flex-col divide-y divide-hairline overflow-hidden rounded-group bg-raised shadow-raised"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                button.current?.focus();
                item.pick();
              }}
              className={`pressable min-h-button px-4 text-left text-body whitespace-nowrap disabled:opacity-40 ${item.danger ? "text-dont-know-text" : ""}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
