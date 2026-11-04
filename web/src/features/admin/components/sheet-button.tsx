"use client";

import { type ReactNode, useState } from "react";

import { Sheet } from "@/design/sheet";

import { button } from "./admin-section";

/**
 * A row's button, [label], or [icon] named by it, that opens [children] in the shared sheet under
 * [title], so a form or a menu shows only when asked for and the page under it does not move.
 */
export function SheetButton({
  label,
  icon,
  title,
  description,
  children,
}: {
  label: string;
  icon?: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={icon === undefined ? undefined : label}
        onClick={() => {
          setOpen(true);
        }}
        className={button.row}
      >
        {icon ?? label}
      </button>
      {open && (
        <Sheet
          title={title}
          description={description}
          close={() => {
            setOpen(false);
          }}
        >
          {children}
        </Sheet>
      )}
    </>
  );
}
