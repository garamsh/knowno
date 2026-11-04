"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { leaveThen } from "@/design/use-back-entry";

/**
 * A link inside a sheet that drops the sheet's history entry before it opens [href], so the back
 * the sheet holds does not undo the page it opens.
 */
export function SheetLink({
  href,
  className,
  children,
}: {
  href: string;
  className: string;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <Link
      href={href}
      onClick={(event) => {
        event.preventDefault();
        leaveThen(() => {
          router.push(href);
        });
      }}
      className={className}
    >
      {children}
    </Link>
  );
}
