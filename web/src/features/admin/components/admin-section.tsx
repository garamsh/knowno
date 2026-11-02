import { type ReactNode, useId } from "react";

/** One group of rows, as `design.md` §Details draws a list: the surface, split by hairlines. */
export const group = "flex flex-col divide-y divide-hairline rounded-group bg-surface";

/** A row inside a [group]. */
export const row = "flex flex-col gap-1 px-4 py-3";

const buttonBase =
  "pressable flex min-h-button items-center justify-center self-start rounded-button px-5 text-button focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50";

/**
 * The admin area's buttons by role: the screen's one primary in the ink fill, a secondary
 * outlined, a destructive one as red text, and the red fill only as the last step of an action
 * that cannot be undone (`design.md` §Details).
 */
export const button = {
  primary: `${buttonBase} bg-primary text-on-primary`,
  secondary: `${buttonBase} bg-surface text-ink`,
  destructive: `${buttonBase} px-1 text-dont-know-text`,
  destructiveFinal: `${buttonBase} bg-dont-know-text text-on-dont-know-text`,
} as const;

/** A field inside a group: no border until it is focused, then a 1.5 px ink outline. */
export const field =
  "min-w-0 rounded-field bg-transparent text-body text-ink placeholder:text-muted focus:outline-[1.5px] focus:outline-ink";

/** A section of an admin page: its label, muted above, and what it holds. */
export function AdminSection({
  label,
  note,
  children,
}: {
  label: string;
  /** A line under the label, for what the section's rows do not say. */
  note?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="px-1 text-section text-muted">
        {label}
      </h2>
      {note !== undefined && <p className="px-1 text-caption text-muted">{note}</p>}
      {children}
    </section>
  );
}

/** What a list shows with nothing in it: what is true, then what to do. */
export function Empty({ children }: { children: string }) {
  return <p className="px-1 text-body text-ink-2">{children}</p>;
}
