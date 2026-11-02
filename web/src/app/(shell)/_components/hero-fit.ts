/**
 * 홈's hero as one grid, shared by the page and its skeleton: its top bar, then the group centred
 * between two spaces, the mascot's row taking what the rows under it leave, from `mascot-hero`
 * down to `mascot-medium`. Given a height, the spaces and then the mascot give way; its least height
 * is the group with the mascot at its floor, so it grows past its height rather than cut a word.
 */
export const heroFit =
  "grid min-h-min grid-rows-[auto_1fr_minmax(var(--spacing-mascot-medium),var(--spacing-mascot-hero))_auto_auto_auto_1fr] lg:h-auto";

/** The hero's group over the mascot's row and the three under it, its first item filling its row. */
export const heroFitGroup =
  "row-span-4 row-start-3 grid grid-rows-subgrid justify-items-center gap-1 text-center [&>:first-child]:h-full [&>:first-child]:w-auto";
