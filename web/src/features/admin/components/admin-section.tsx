import { buttonClass } from "@/design/button";

/** One group of rows, as `design/frames.md` §Group and section draws a list: the surface, split by hairlines. */
export const group = "flex flex-col divide-y divide-hairline rounded-group bg-surface";

/** A row inside a [group]. */
export const row = "flex flex-col gap-1 px-4 py-3";

/**
 * The admin area's buttons by role, each the one button (`@/design/button`) at the start of its
 * column: the screen's one primary, a secondary on the surface, a destructive one as red text, and
 * the red fill only as the last step of an action that cannot be undone (`design/principles.md` §One primary action per screen).
 */
export const button = {
  primary: `${buttonClass("primary")} self-start`,
  secondary: `${buttonClass("secondary")} self-start`,
  destructive: `${buttonClass("destructive")} self-start`,
  destructiveFinal: `${buttonClass("destructiveFinal")} self-start`,
  /** An action in a row or a card: on the surface, a tap target high, in the label type. */
  row: `${buttonClass("secondary", "header")} self-start`,
  /** A destructive action in a row or a menu: red text, a tap target high. */
  rowDestructive: `${buttonClass("destructive", "header")} self-start`,
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

/** What a list shows with nothing in it: what is true, then what to do. */
export function Empty({ children }: { children: string }) {
  return <p className="px-1 text-body text-ink-2">{children}</p>;
}
