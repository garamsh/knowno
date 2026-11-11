import type { ReactNode } from "react";

import { Mascot, type MascotExpression, useReducedMotion } from "@/design/brand";

/** What the profile is called above a bubble and in the empty chat (ADR 0250). */
const name = "말랑이";

/** What a screen reader hears of the dots: the old waiting line, kept as their name. */
const thinking = "말랑이가 생각하는 중이에요";

/** 말랑이's profile: its mascot in [face] on a rounded square of the deck-peach ground, 40 px, or 96 px when [large]. */
function Profile({ face, large = false }: { face: MascotExpression; large?: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center bg-deck-peach ${large ? "size-24 rounded-card" : "size-10 rounded-field"}`}
    >
      <Mascot expression={face} className="size-4/5" />
    </span>
  );
}

/**
 * A row of 말랑이's beside its profile with "말랑이" above [children], where [face] is given, and
 * in the profile's place, bare, where it is null: a later item of the same run.
 */
export function Beside({ face, children }: { face: MascotExpression | null; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <div className="w-10 shrink-0">{face && <Profile face={face} />}</div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {face && (
          <span aria-hidden className="text-secondary text-muted">
            {name}
          </span>
        )}
        {children}
      </div>
    </li>
  );
}

/** The empty chat: the large profile, "말랑이" and what to memorise. */
export function EmptyChat({ face }: { face: MascotExpression }) {
  return (
    <li className="flex flex-col items-center gap-2 py-10 text-center">
      <Profile face={face} large />
      <p aria-hidden className="text-body-strong">
        {name}
      </p>
      <p className="text-body break-keep text-muted">무엇을 외워 볼까요?</p>
    </li>
  );
}

/**
 * The sign that a reply is being made: a bubble of three dots rising in turn, still under reduced
 * motion, with the passing [line] beside it where the server sent one.
 */
export function Typing({ face, line }: { face: MascotExpression | null; line: ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <Beside face={face}>
      <div className="flex items-center gap-3">
        <span
          role="status"
          aria-live="polite"
          className="flex shrink-0 rounded-row border border-hairline bg-surface p-4"
        >
          <span className="sr-only">{thinking}</span>
          <span aria-hidden className="flex h-3 items-end gap-1">
            {[0, 1, 2].map((at) => (
              <span
                key={at}
                data-typing-dot
                style={{ animationDelay: `${String(at * 180)}ms` }}
                className={`size-2 rounded-full bg-muted ${reduced ? "" : "animate-typing-dot"}`}
              />
            ))}
          </span>
        </span>
        {line}
      </div>
    </Beside>
  );
}
