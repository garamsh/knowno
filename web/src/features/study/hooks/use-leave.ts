"use client";

import { useRouter } from "next/navigation";
import { type MouseEvent, useEffect, useRef, useState } from "react";

import type { WriteQueue } from "../write-queue";

/**
 * Leaving the study page while [writes] holds answers not saved: [exit] sends them before a link
 * out is followed, and [leaving] holds where it was going while the screen asks, which [stay]
 * answers by staying and [go] by going. While [unsaved], unloading the page asks the browser first.
 */
export function useLeave(writes: WriteQueue, unsaved: boolean) {
  const router = useRouter();
  /** Where a leave held back by unsaved answers was going, while the screen asks; else null. */
  const [leaving, setLeaving] = useState<string | null>(null);
  /** The control that asked to leave, which takes the focus back if the user stays. */
  const leaveFrom = useRef<HTMLElement | null>(null);
  /**
   * A link out of the page while answers wait to be saved: instead of following it, sends them,
   * the failed one again first, then goes to [href], or asks before leaving if one fails again.
   */
  function exit(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (writes.getStatus().pending === 0) return;
    event.preventDefault();
    leaveFrom.current = event.currentTarget;
    void writes.flush().then((saved) => {
      if (saved) router.push(href);
      else setLeaving(href);
    });
  }
  function stay() {
    setLeaving(null);
    leaveFrom.current?.focus();
  }
  function go(href: string) {
    router.push(href);
  }
  // Unloading the page drops the writes still waiting, so the browser asks first; the page's own
  // links out go through [exit].
  useEffect(() => {
    if (!unsaved) return;
    const listener = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", listener);
    return () => {
      window.removeEventListener("beforeunload", listener);
    };
  }, [unsaved]);
  return { leaving, exit, stay, go };
}
