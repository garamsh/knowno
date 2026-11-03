import type { ReactNode } from "react";

import { readRequestTime } from "../read-time";
import { StudyFreshness } from "./study-freshness";

/**
 * Wraps a page's content that shows study state, taking the server's time at the request before
 * [children] render and read their data, and hands it to `StudyFreshness` (ADR 0169). Mount it
 * inside a Suspense boundary: the time is read at request time.
 */
export async function StudyStateRead({ children }: { children: ReactNode }) {
  const readAt = await readRequestTime();
  return (
    <>
      <StudyFreshness readAt={readAt} />
      {children}
    </>
  );
}
