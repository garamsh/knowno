"use client";

import { ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Sheet } from "@/design/sheet";

import { actionRow, button } from "./admin-section";

/**
 * A row's button, [label], or [icon] named by it, that opens [children] in the shared sheet under
 * [title], so a form or a menu shows only when asked for and the page under it does not move. As
 * a [row] it is a row ending a group, with a chevron.
 */
export function SheetButton({
  label,
  icon,
  row = false,
  title,
  description,
  children,
}: {
  label: string;
  icon?: ReactNode;
  row?: boolean;
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
        className={row ? actionRow : button.row}
      >
        {row ? (
          <>
            {label}
            <ChevronRight aria-hidden className="size-5 shrink-0 text-muted" />
          </>
        ) : (
          (icon ?? label)
        )}
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
