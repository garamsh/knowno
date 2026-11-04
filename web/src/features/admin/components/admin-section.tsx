import { Fragment } from "react";

import { buttonClass } from "@/design/button";

/** One group of rows, as `design/frames.md` §Group and section draws a list: the surface, split by hairlines. */
export const group = "flex flex-col divide-y divide-hairline rounded-group bg-surface";

/** A row inside a [group]. */
export const row = "flex flex-col gap-1 px-4 py-3";

/** A row inside a [group] that opens a page: the whole row is the link, pressed as one. */
export const linkRow =
  "pressable flex min-h-13 items-center justify-between gap-3 px-4 py-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink";

/** A line of a form inside a [group]: its label at the start, its field at the end. */
export const formLine = "flex min-h-button items-center justify-between gap-3 px-4";

/** A field on a [formLine]: a [field] a tap target high, its value at the end. */
export const formInput = "h-tap-target min-w-0 px-2 text-right";

/**
 * The admin area's buttons by role, each the one button (`@/design/button`) at the start of its
 * column: the screen's one primary, a secondary on the surface, a destructive one as red text, and
 * the red fill only as the last step of an action that cannot be undone (`design/principles.md`
 * §One primary action per screen).
 */
export const button = {
  primary: `${buttonClass("primary")} self-start`,
  secondary: `${buttonClass("secondary")} self-start`,
  destructive: `${buttonClass("destructive")} self-start`,
  destructiveFinal: `${buttonClass("destructiveFinal")} self-start`,
  /** An action in a row or a card: on the surface, a tap target high, in the label type. */
  row: `${buttonClass("secondary", "header")} w-fit self-start`,
  /** A destructive action in a row or a menu: red text, a tap target high. */
  rowDestructive: `${buttonClass("destructive", "header")} w-fit self-start`,
} as const;

/** A card of 처리할 일 or 사진 AI: one solid surface on its edge, holding a figure and one action. */
export const card = "flex flex-col gap-2 rounded-group bg-surface p-5";

/**
 * A link of the menu or of a section's view switch: the current one in `accent` on the brand
 * tint, the others `ink-2`, as design/components.md §Material widgets draws the current menu item.
 */
export function switchLink(current: boolean): string {
  return `pressable flex min-h-tap-target items-center rounded-button px-3 text-label whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
    current ? "bg-brand-tint text-accent" : "text-ink-2"
  }`;
}

/** A field inside a group: no border until it is focused, then a 1.5 px ink outline. */
export const field =
  "min-w-0 rounded-field bg-transparent text-body text-ink placeholder:text-muted focus:outline-[1.5px] focus:outline-ink";

/**
 * A filter over a list, a native select on the ground: `search` high inside its outline, as the
 * search beside it.
 */
export const filter =
  "h-search min-w-0 rounded-field border border-outline bg-surface px-3 text-label text-ink focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-ink";

/**
 * A set of facts, each a term and its value on one row of a [group]; a value's parts between " · "
 * are each kept whole, so a model's id or a date wraps as one.
 */
export function Facts({ facts }: { facts: readonly (readonly [string, string])[] }) {
  return (
    <dl className={group}>
      {facts.map(([term, value]) => (
        <div key={term} className="flex items-baseline justify-between gap-3 px-4 py-3">
          <dt className="shrink-0 text-body text-ink-2">{term}</dt>
          <dd className="min-w-0 text-right text-body-strong tabular-nums">
            {value.split(" · ").map((part, index) => (
              <Fragment key={index}>
                {index > 0 && " · "}
                <span className={whole}>{part}</span>
              </Fragment>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A part of a line kept whole, as a word is: it moves to the next line rather than break at a
 * hyphen or a slash, and breaks inside only where it is longer than a whole line
 * (`design/principles.md` §Nothing clipped).
 */
const whole = "inline-block max-w-full break-words";

/**
 * An email that may break before its `@`, where `break-words` would otherwise break it at any
 * letter. Its text stays one run, so a screen reader and an accessible name read it whole.
 */
export function Email({ email }: { email: string }) {
  const at = email.lastIndexOf("@");
  if (at <= 0) return email;
  return (
    <>
      {email.slice(0, at)}
      <wbr />
      {email.slice(at)}
    </>
  );
}

/** What a list shows with nothing in it: what is true, then what to do. */
export function Empty({ children }: { children: string }) {
  return <p className="px-1 text-body text-ink-2">{children}</p>;
}
